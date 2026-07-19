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
  lookupOrder,
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
    lookupOrder: jest.fn(),
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
  lookupOrder.mockReset();
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
const SHOP_CHECKOUT_FAILURE = 'We could not confirm checkout. Do not try again. Contact MPRC for help.';
const EVENTS_LOAD_FAILURE = 'Error: We could not load events right now. Please try again later.';
const EVENTS_CALENDAR_LOAD_FAILURE = 'We could not load events right now. Please try again later.';
const EVENT_DETAIL_LOAD_FAILURE = 'We could not load this event right now. Please try again later.';
const EVENT_REGISTER_LOAD_FAILURE = 'We could not load this event right now. Please try again later.';
const EVENT_REGISTER_SUBMIT_FAILURE = 'We could not confirm your registration. Do not try again. Contact MPRC for help.';
const ADMIN_PRODUCTS_LOAD_FAILURE = 'We could not load products right now. Please try again later.';
const ADMIN_PRODUCT_EDITOR_LOAD_FAILURE = 'We could not load this product right now. Please try again later.';
const ADMIN_EVENTS_LOAD_FAILURE = 'We could not load events right now. Please try again later.';
const ADMIN_EVENT_EDITOR_LOAD_FAILURE = 'We could not load this event right now. Please try again later.';
const ADMIN_EVENT_SAVE_PENDING = 'Event save in progress. Do not start another save.';
const ADMIN_EVENT_SAVE_UNKNOWN = 'We could not confirm that event save. Do not repeat it. Stop and contact the event lead, treasurer, and platform owner.';
const ADMIN_EVENT_REGISTRATIONS_LOAD_FAILURE = 'We could not load registrations right now. Stop and contact the event lead, treasurer, and platform owner before taking any registration action.';
const ADMIN_LATE_REGISTRATION_OUTCOME_UNKNOWN = 'We could not confirm this $0 late registration. Do not try again on this page. Stop and contact the event lead, treasurer, and platform owner.';
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

function purchaseSuccessPath({
  order = 'synthetic-confirmation-order',
  token = 'synthetic-order-capability',
} = {}) {
  const params = new URLSearchParams();
  if (order !== null) params.set('order', order);
  if (token !== null) params.set('token', token);
  return `/shop/purchase/success?${params.toString()}`;
}

function renderPurchaseSuccess(query) {
  window.history.pushState({}, '', purchaseSuccessPath(query));
  return render(<App />);
}

let purchaseHistoryKey = 0;

function navigatePurchaseSuccess(query) {
  purchaseHistoryKey += 1;
  const currentIndex = typeof window.history.state?.idx === 'number'
    ? window.history.state.idx
    : 0;
  const nextState = {
    usr: null,
    key: `synthetic-purchase-${purchaseHistoryKey}`,
    idx: currentIndex + 1,
  };
  window.history.pushState(nextState, '', purchaseSuccessPath(query));
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
    const submitButton = screen.getByRole('button', {
      name: 'Continue to payment — $15.00',
    });
    expect(submitButton).toBeDisabled();
    const form = submitButton.closest('form');
    expect(form).not.toBeNull();
    fireEvent.click(submitButton);
    fireEvent.submit(form);
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
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
    expect(screen.getByRole('button', {
      name: 'Continue to payment — $15.00',
    })).toBeDisabled();
    expect(window.location.pathname).toBe('/events/synthetic-event/register');
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('locks the page after a paid result has no usable URL', async () => {
    const unexpectedGetter = jest.fn(() => {
      throw new Error('registration-result-getter-canary');
    });
    createCheckoutSession.mockResolvedValueOnce(Object.defineProperty(
      {
        registrationId: 'synthetic-registration',
        free: false,
      },
      'unexpected',
      {
        configurable: true,
        get: unexpectedGetter,
      },
    ));

    renderPublicEventRegister();
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Register for Synthetic Registration Event',
    })).toBeInTheDocument();
    fillRequiredRegistrationFields();
    fireEvent.click(screen.getByRole('button', {
      name: 'Continue to payment — $15.00',
    }));

    expect((await screen.findByRole('alert')).textContent)
      .toBe(EVENT_REGISTER_SUBMIT_FAILURE);
    expect(unexpectedGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('registration-result-getter-canary');
    expect(screen.getByRole('textbox', { name: 'First name *' })).toHaveValue('Synthetic');
    expect(screen.getByRole('textbox', { name: 'Last name *' })).toHaveValue('Runner');
    expect(screen.getByRole('textbox', { name: 'Email *' })).toHaveValue('runner@example.test');
    expect(screen.getByRole('checkbox', { name: /accept the waiver/i })).toBeChecked();

    const submitButton = screen.getByRole('button', {
      name: 'Continue to payment — $15.00',
    });
    expect(submitButton).toBeDisabled();
    const form = submitButton.closest('form');
    expect(form).not.toBeNull();
    fireEvent.click(submitButton);
    fireEvent.submit(form);

    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(track.mock.calls)).not.toContain('registration-result-getter-canary');
    expect(window.location.pathname).toBe('/events/synthetic-event/register');
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

describe('DATA-001A2 purchase confirmation attempt isolation', () => {
  const routeA = {
    order: 'synthetic-route-a-order',
    token: 'synthetic-route-a-order-capability',
  };
  const routeB = {
    order: 'synthetic-route-b-order',
    token: 'synthetic-route-b-order-capability',
  };

  function readyLocator(app = firebaseApp) {
    return {
      services: { firebaseResources: { app } },
      isReady: true,
    };
  }

  function orderResult({
    status = 'pending',
    id = 'synthetic-confirmation-order',
    firstName = 'Synthetic',
    email = 'synthetic-buyer@example.test',
    productTitle = 'Synthetic Club Jacket',
    amountCents = 1500,
    size = 'M',
    color = 'Navy',
  } = {}) {
    return {
      id,
      status,
      amountCents,
      currency: 'usd',
      productSlug: 'synthetic-club-jacket',
      productTitle,
      size,
      color,
      buyer: {
        firstName,
        lastName: 'Buyer',
        email,
      },
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

  async function flushPurchaseWork() {
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

  test('hides order A immediately and keeps a pending order B private', async () => {
    const routeBLookup = deferred();
    lookupOrder
      .mockResolvedValueOnce(orderResult({
        status: 'paid',
        id: routeA.order,
        firstName: 'Prior',
        email: 'prior-buyer@example.test',
      }))
      .mockReturnValueOnce(routeBLookup.promise);

    renderPurchaseSuccess(routeA);
    await flushPurchaseWork();
    expect(screen.getByRole('heading', { name: 'Order confirmed!' })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('prior-buyer@example.test');

    navigatePurchaseSuccess(routeB);
    const immediateRouteText = document.body.textContent;

    await resolveDeferred(routeBLookup, orderResult({
      status: 'pending',
      id: routeB.order,
      firstName: 'Pending',
      email: 'pending-buyer@example.test',
    }));
    const pendingRouteText = document.body.textContent;

    expect(immediateRouteText).toContain('Processing your order...');
    expect(immediateRouteText).not.toMatch(
      /Prior|prior-buyer@example\.test|synthetic-route-a-order|Order confirmed!|Synthetic Club Jacket/,
    );
    expect(pendingRouteText).toContain('Processing your order...');
    expect(pendingRouteText).not.toMatch(
      /Pending|pending-buyer@example\.test|synthetic-route-b-order|Order confirmed!|Synthetic Club Jacket/,
    );
    expect(track).not.toHaveBeenCalled();
  });

  test.each([
    'route',
    'services identity',
    'Firebase app identity',
    'readiness',
  ])('hides confirmed order details in the first %s-change commit', async (changedBoundary) => {
    const initialLocator = readyLocator();
    const commits = [];
    const captureCommit = () => {
      commits.push(document.querySelector('main')?.textContent ?? '');
    };
    const profiledApp = () => (
      <React.Profiler id="purchase-confirmation" onRender={captureCommit}>
        <App />
      </React.Profiler>
    );
    useServiceLocator.mockReturnValue(initialLocator);
    lookupOrder.mockResolvedValueOnce(orderResult({
      status: 'paid',
      id: routeA.order,
      firstName: 'Prior',
      email: 'prior-order-commit@example.test',
    }));
    window.history.pushState({}, '', purchaseSuccessPath(routeA));
    const view = render(profiledApp());
    await flushPurchaseWork();
    expect(document.body).toHaveTextContent('prior-order-commit@example.test');

    commits.length = 0;
    lookupOrder.mockReturnValueOnce(new Promise(() => {}));
    if (changedBoundary === 'route') {
      navigatePurchaseSuccess(routeB);
    } else {
      let nextLocator = readyLocator();
      if (changedBoundary === 'Firebase app identity') {
        initialLocator.services.firebaseResources.app = {
          name: 'synthetic-purchase-app-b',
        };
        nextLocator = initialLocator;
      } else if (changedBoundary === 'readiness') {
        nextLocator = { services: initialLocator.services, isReady: false };
      }
      useServiceLocator.mockReturnValue(nextLocator);
      view.rerender(profiledApp());
    }

    expect(commits).not.toHaveLength(0);
    expect(commits[0]).toContain('Processing your order...');
    expect(commits[0]).not.toMatch(
      /Prior|prior-order-commit@example\.test|synthetic-route-a-order|Order confirmed!|Synthetic Club Jacket/,
    );
    expect(track).not.toHaveBeenCalled();
  });

  test('keeps one attempt when the router republishes the same purchase entry', async () => {
    const commits = [];
    const captureCommit = () => {
      commits.push(document.querySelector('main')?.textContent ?? '');
    };
    lookupOrder.mockResolvedValueOnce(orderResult({
      status: 'paid',
      id: routeA.order,
      firstName: 'Current',
      email: 'same-purchase-entry@example.test',
    }));
    window.history.pushState({}, '', purchaseSuccessPath(routeA));
    render(
      <React.Profiler id="purchase-confirmation" onRender={captureCommit}>
        <App />
      </React.Profiler>,
    );
    await flushPurchaseWork();
    expect(document.body).toHaveTextContent('same-purchase-entry@example.test');

    commits.length = 0;
    const sameEntryState = {
      ...window.history.state,
      usr: { syntheticObjectRefresh: true },
    };
    window.history.replaceState(
      sameEntryState,
      '',
      purchaseSuccessPath(routeA),
    );
    fireEvent(window, new PopStateEvent('popstate', { state: sameEntryState }));
    await flushPurchaseWork();

    expect(commits).not.toHaveLength(0);
    expect(document.body).toHaveTextContent('same-purchase-entry@example.test');
    expect(lookupOrder).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
  });

  test.each([
    ['order', { ...routeA, order: routeB.order }],
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
    lookupOrder
      .mockResolvedValueOnce(orderResult({
        status: 'paid',
        id: routeA.order,
        firstName: 'Prior',
        email: 'prior-same-key-order@example.test',
      }))
      .mockReturnValueOnce(routeBLookup.promise);
    window.history.pushState({}, '', purchaseSuccessPath(routeA));
    render(
      <React.Profiler id="purchase-confirmation" onRender={captureCommit}>
        <App />
      </React.Profiler>,
    );
    await flushPurchaseWork();
    expect(document.body).toHaveTextContent('prior-same-key-order@example.test');

    commits.length = 0;
    const preservedHistoryState = { ...window.history.state };
    const preservedHistoryKey = window.history.state?.key;
    window.history.replaceState(
      preservedHistoryState,
      '',
      purchaseSuccessPath(changedRoute),
    );
    fireEvent(window, new PopStateEvent('popstate', { state: preservedHistoryState }));

    expect(window.history.state?.key).toBe(preservedHistoryKey);
    expect(commits).not.toHaveLength(0);
    expect(commits[0]).toContain('Processing your order...');
    expect(commits[0]).not.toMatch(
      /Prior|prior-same-key-order@example\.test|synthetic-route-a-order|Order confirmed!|Synthetic Club Jacket/,
    );
    expect(lookupOrder).toHaveBeenNthCalledWith(2, firebaseApp, {
      orderId: changedRoute.order,
      token: changedRoute.token,
    });

    await resolveDeferred(routeBLookup, orderResult({
      status: 'pending',
      id: changedRoute.order,
      firstName: 'Pending',
      email: 'pending-same-key-order@example.test',
    }));

    expect(screen.getByRole('heading', { name: 'Processing your order...' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /prior-same-key-order@example\.test|pending-same-key-order@example\.test|Order confirmed!/,
    );
    expect(track).not.toHaveBeenCalled();
  });

  test('starts a new attempt when a new history entry repeats the same purchase tuple', async () => {
    const commits = [];
    const captureCommit = () => {
      commits.push(document.querySelector('main')?.textContent ?? '');
    };
    lookupOrder
      .mockResolvedValueOnce(orderResult({
        status: 'paid',
        id: routeA.order,
        firstName: 'Prior',
        email: 'prior-new-key-order@example.test',
      }))
      .mockReturnValueOnce(new Promise(() => {}));
    window.history.pushState({}, '', purchaseSuccessPath(routeA));
    render(
      <React.Profiler id="purchase-confirmation" onRender={captureCommit}>
        <App />
      </React.Profiler>,
    );
    await flushPurchaseWork();

    commits.length = 0;
    navigatePurchaseSuccess(routeA);

    expect(commits).not.toHaveLength(0);
    expect(commits[0]).toContain('Processing your order...');
    expect(commits[0]).not.toMatch(
      /Prior|prior-new-key-order@example\.test|synthetic-route-a-order|Order confirmed!|Synthetic Club Jacket/,
    );
    expect(lookupOrder).toHaveBeenCalledTimes(2);
    expect(track).not.toHaveBeenCalled();
  });

  test('ignores a stale route success before inspecting it', async () => {
    const staleLookup = deferred();
    lookupOrder
      .mockReturnValueOnce(staleLookup.promise)
      .mockResolvedValueOnce(orderResult({
        status: 'paid',
        id: routeB.order,
        firstName: 'Current',
        email: 'current-order@example.test',
      }));

    renderPurchaseSuccess(routeA);
    navigatePurchaseSuccess(routeB);
    await flushPurchaseWork();

    const statusGetter = jest.fn(() => 'paid');
    const staleResult = orderResult({
      id: routeA.order,
      firstName: 'Obsolete',
      email: 'obsolete-order@example.test',
    });
    delete staleResult.status;
    Object.defineProperty(staleResult, 'status', {
      configurable: true,
      enumerable: true,
      get: statusGetter,
    });
    await resolveDeferred(staleLookup, staleResult);

    expect(statusGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Order confirmed!' })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('current-order@example.test');
    expect(document.body).not.toHaveTextContent('obsolete-order@example.test');
    expect(track).not.toHaveBeenCalled();
  });

  test('ignores a stale hostile rejection before reading code or details', async () => {
    const staleLookup = deferred();
    lookupOrder
      .mockReturnValueOnce(staleLookup.promise)
      .mockResolvedValueOnce(orderResult({
        status: 'fulfilled',
        id: routeB.order,
        firstName: 'Current',
        email: 'current-fulfilled-order@example.test',
      }));

    renderPurchaseSuccess(routeA);
    navigatePurchaseSuccess(routeB);
    await flushPurchaseWork();

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
    expect(screen.getByRole('heading', { name: 'Order confirmed!' })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('current-fulfilled-order@example.test');
    expect(screen.queryByText("Can't confirm this order")).not.toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test('clears an order-owned poll timer and prevents another old lookup', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    const routeBLookup = deferred();
    const neverSettles = new Promise(() => {});
    lookupOrder
      .mockResolvedValueOnce(orderResult({
        status: 'pending',
        id: routeA.order,
      }))
      .mockReturnValueOnce(routeBLookup.promise)
      .mockReturnValue(neverSettles);

    renderPurchaseSuccess(routeA);
    await flushPurchaseWork();
    const pollTimerIndex = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 2000);
    expect(pollTimerIndex).toBeGreaterThanOrEqual(0);
    const pollTimerId = setTimeoutSpy.mock.results[pollTimerIndex].value;

    navigatePurchaseSuccess(routeB);
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    const routeACalls = lookupOrder.mock.calls.filter(([, args]) => (
      args.orderId === routeA.order
    ));
    expect(routeACalls).toHaveLength(1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(pollTimerId);
    expect(lookupOrder).toHaveBeenCalledTimes(2);
    expect(track).not.toHaveBeenCalled();
  });

  test.each([
    'services identity',
    'Firebase app identity',
  ])('invalidates an in-flight order lookup when %s changes', async (changedIdentity) => {
    const appA = { name: 'synthetic-purchase-app-a' };
    const appB = changedIdentity === 'Firebase app identity'
      ? { name: 'synthetic-purchase-app-b' }
      : appA;
    const initialLocator = readyLocator(appA);
    const staleLookup = deferred();
    lookupOrder
      .mockReturnValueOnce(staleLookup.promise)
      .mockResolvedValueOnce(orderResult({
        status: 'paid',
        id: routeA.order,
        firstName: 'Current',
        email: 'current-service-order@example.test',
      }));
    useServiceLocator.mockReturnValue(initialLocator);

    const view = renderPurchaseSuccess(routeA);
    if (changedIdentity === 'Firebase app identity') {
      initialLocator.services.firebaseResources.app = appB;
      useServiceLocator.mockReturnValue(initialLocator);
    } else {
      useServiceLocator.mockReturnValue(readyLocator(appB));
    }
    view.rerender(<App />);
    await flushPurchaseWork();
    await resolveDeferred(staleLookup, orderResult({
      status: 'paid',
      id: routeA.order,
      firstName: 'Obsolete',
      email: 'obsolete-service-order@example.test',
    }));

    expect(lookupOrder).toHaveBeenNthCalledWith(1, appA, {
      orderId: routeA.order,
      token: routeA.token,
    });
    expect(lookupOrder).toHaveBeenNthCalledWith(2, appB, {
      orderId: routeA.order,
      token: routeA.token,
    });
    expect(document.body).toHaveTextContent('current-service-order@example.test');
    expect(document.body).not.toHaveTextContent('obsolete-service-order@example.test');
    expect(track).not.toHaveBeenCalled();
  });

  test('invalidates an in-flight order lookup when readiness is lost', async () => {
    const staleLookup = deferred();
    lookupOrder.mockReturnValueOnce(staleLookup.promise);
    const view = renderPurchaseSuccess(routeA);

    useServiceLocator.mockReturnValue({ services: null, isReady: false });
    view.rerender(<App />);
    await resolveDeferred(staleLookup, orderResult({
      status: 'paid',
      id: routeA.order,
      firstName: 'Obsolete',
      email: 'obsolete-readiness-order@example.test',
    }));

    expect(screen.getByRole('heading', { name: 'Processing your order...' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('obsolete-readiness-order@example.test');
    expect(track).not.toHaveBeenCalled();
  });

  test('treats purchase A to B to A as three generations', async () => {
    const firstRouteALookup = deferred();
    const routeBLookup = deferred();
    lookupOrder
      .mockReturnValueOnce(firstRouteALookup.promise)
      .mockReturnValueOnce(routeBLookup.promise)
      .mockResolvedValueOnce(orderResult({
        status: 'paid',
        id: routeA.order,
        firstName: 'Current',
        email: 'current-returned-order@example.test',
      }));

    renderPurchaseSuccess(routeA);
    navigatePurchaseSuccess(routeB);
    navigatePurchaseSuccess(routeA);
    await flushPurchaseWork();
    await resolveDeferred(firstRouteALookup, orderResult({
      status: 'paid',
      id: routeA.order,
      firstName: 'Obsolete',
      email: 'obsolete-first-order@example.test',
    }));

    expect(document.body).toHaveTextContent('current-returned-order@example.test');
    expect(document.body).not.toHaveTextContent('obsolete-first-order@example.test');
    expect(track).not.toHaveBeenCalled();
  });

  test('keeps the second StrictMode purchase effect current', async () => {
    const firstEffectLookup = deferred();
    const secondEffectLookup = deferred();
    lookupOrder
      .mockReturnValueOnce(firstEffectLookup.promise)
      .mockReturnValueOnce(secondEffectLookup.promise);
    window.history.pushState({}, '', purchaseSuccessPath(routeA));

    render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    expect(lookupOrder).toHaveBeenCalledTimes(2);

    await resolveDeferred(secondEffectLookup, orderResult({
      status: 'fulfilled',
      id: routeA.order,
      firstName: 'Current',
      email: 'current-strict-order@example.test',
    }));
    const statusGetter = jest.fn(() => 'paid');
    const firstEffectResult = orderResult({
      id: routeA.order,
      firstName: 'Obsolete',
      email: 'obsolete-strict-order@example.test',
    });
    delete firstEffectResult.status;
    Object.defineProperty(firstEffectResult, 'status', {
      configurable: true,
      enumerable: true,
      get: statusGetter,
    });
    await resolveDeferred(firstEffectLookup, firstEffectResult);

    expect(statusGetter).not.toHaveBeenCalled();
    expect(document.body).toHaveTextContent('current-strict-order@example.test');
    expect(document.body).not.toHaveTextContent('obsolete-strict-order@example.test');
    expect(track).not.toHaveBeenCalled();
  });

  test('does not inspect an order result after unmount', async () => {
    const staleLookup = deferred();
    lookupOrder.mockReturnValueOnce(staleLookup.promise);
    const view = renderPurchaseSuccess(routeA);
    const statusGetter = jest.fn(() => 'paid');
    const staleResult = orderResult({
      id: routeA.order,
      firstName: 'Unmounted',
      email: 'unmounted-order@example.test',
    });
    delete staleResult.status;
    Object.defineProperty(staleResult, 'status', {
      configurable: true,
      enumerable: true,
      get: statusGetter,
    });

    view.unmount();
    await resolveDeferred(staleLookup, staleResult);

    expect(statusGetter).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  test('does not inspect an order rejection after unmount', async () => {
    const staleLookup = deferred();
    lookupOrder.mockReturnValueOnce(staleLookup.promise);
    const view = renderPurchaseSuccess(routeA);
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
    'paid',
    'fulfilled',
  ])('preserves a current %s order without analytics', async (status) => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    lookupOrder.mockResolvedValueOnce(orderResult({
      status,
      id: routeA.order,
      firstName: 'Confirmed',
      email: 'confirmed-order@example.test',
    }));

    renderPurchaseSuccess(routeA);
    await flushPurchaseWork();

    expect(screen.getByRole('heading', { name: 'Order confirmed!' })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('Confirmed');
    expect(document.body).toHaveTextContent('confirmed-order@example.test');
    expect(document.body).toHaveTextContent('Synthetic Club Jacket');
    expect(document.body).toHaveTextContent('size M');
    expect(document.body).toHaveTextContent('Navy');
    expect(document.body).toHaveTextContent('$15.00');
    expect(document.body).toHaveTextContent(routeA.order);
    expect(screen.getByRole('link', { name: '← Back to shop' })).toHaveAttribute('href', '/shop');
    expect(lookupOrder).toHaveBeenCalledWith(firebaseApp, {
      orderId: routeA.order,
      token: routeA.token,
    });
    expect(lookupOrder).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    expect(JSON.stringify(track.mock.calls)).not.toContain(routeA.token);
    expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 2000)).toBe(false);
  });

  test('preserves current pending polling before a paid order', async () => {
    lookupOrder
      .mockResolvedValueOnce(orderResult({
        status: 'pending',
        id: routeA.order,
        firstName: 'Pending',
        email: 'pending-current-order@example.test',
      }))
      .mockResolvedValueOnce(orderResult({
        status: 'paid',
        id: routeA.order,
        firstName: 'Polled',
        email: 'polled-order@example.test',
      }));

    renderPurchaseSuccess(routeA);
    await flushPurchaseWork();
    expect(screen.getByRole('heading', { name: 'Processing your order...' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('pending-current-order@example.test');
    expect(track).not.toHaveBeenCalled();

    await advancePollIntervals(1);

    expect(screen.getByRole('heading', { name: 'Order confirmed!' })).toBeInTheDocument();
    expect(document.body).toHaveTextContent('polled-order@example.test');
    expect(lookupOrder).toHaveBeenCalledTimes(2);
    expect(track).not.toHaveBeenCalled();
  });

  test('preserves the current pending order timeout outcome', async () => {
    lookupOrder.mockResolvedValue(orderResult({
      status: 'pending',
      id: routeA.order,
    }));

    renderPurchaseSuccess(routeA);
    await flushPurchaseWork();
    await advancePollIntervals(15);

    expect(screen.getByRole('heading', { name: 'Processing your order...' })).toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();

    await advancePollIntervals(1);

    expect(screen.getByRole('heading', { name: 'Still processing...' })).toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test.each([
    ['top-level', { code: 'permission-denied' }],
    ['nested', { details: { code: 'permission-denied' } }],
    ['nested after an empty direct code', { code: '', details: { code: 'permission-denied' } }],
  ])('preserves the current %s order permission-denied outcome', async (_shape, rejection) => {
    lookupOrder.mockRejectedValueOnce(rejection);

    renderPurchaseSuccess(routeA);
    await flushPurchaseWork();

    expect(screen.getByRole('heading', { name: "Can't confirm this order" }))
      .toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test('preserves a malformed direct order code ahead of nested permission denial', async () => {
    lookupOrder.mockRejectedValueOnce({
      code: {},
      details: { code: 'permission-denied' },
    });

    renderPurchaseSuccess(routeA);
    await flushPurchaseWork();

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.queryByText("Can't confirm this order")).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test('classifies current order accessor fields without invoking them', async () => {
    const codeGetter = jest.fn(() => 'permission-denied');
    const detailsGetter = jest.fn(() => ({ code: 'permission-denied' }));
    const rejection = {};
    Object.defineProperties(rejection, {
      code: { configurable: true, get: codeGetter },
      details: { configurable: true, get: detailsGetter },
    });
    lookupOrder.mockRejectedValueOnce(rejection);

    renderPurchaseSuccess(routeA);
    await flushPurchaseWork();

    expect(codeGetter).not.toHaveBeenCalled();
    expect(detailsGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.queryByText("Can't confirm this order")).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test('classifies inherited order error fields without invoking them', async () => {
    const codeGetter = jest.fn(() => 'permission-denied');
    const detailsGetter = jest.fn(() => ({ code: 'permission-denied' }));
    const prototype = {};
    Object.defineProperties(prototype, {
      code: { configurable: true, get: codeGetter },
      details: { configurable: true, get: detailsGetter },
    });
    const rejection = Object.create(prototype);
    lookupOrder.mockRejectedValueOnce(rejection);

    renderPurchaseSuccess(routeA);
    await flushPurchaseWork();

    expect(codeGetter).not.toHaveBeenCalled();
    expect(detailsGetter).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.queryByText("Can't confirm this order")).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test('contains a descriptor trap while classifying a current order error', async () => {
    const descriptorTrap = jest.fn(() => {
      throw new Error('synthetic-order-descriptor-trap-private-canary');
    });
    const valueReadTrap = jest.fn((_target, key) => {
      if (key === 'code') return 'permission-denied';
      return undefined;
    });
    const rejection = new Proxy({}, {
      get: valueReadTrap,
      getOwnPropertyDescriptor: descriptorTrap,
    });
    lookupOrder.mockRejectedValueOnce(rejection);

    renderPurchaseSuccess(routeA);
    await flushPurchaseWork();

    expect(descriptorTrap).toHaveBeenCalledTimes(2);
    expect(valueReadTrap).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('synthetic-order-descriptor-trap-private-canary');
    expect(screen.queryByText("Can't confirm this order")).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });

  test('preserves a generic current order error without exposing its message', async () => {
    lookupOrder.mockRejectedValueOnce(
      new Error('synthetic-order-provider-private-canary'),
    );

    renderPurchaseSuccess(routeA);
    await flushPurchaseWork();

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('synthetic-order-provider-private-canary');
    expect(track).not.toHaveBeenCalled();
  });

  test('waits for services and then uses the current app and order capability', async () => {
    useServiceLocator.mockReturnValue({ services: null, isReady: false });
    lookupOrder.mockResolvedValueOnce(orderResult({
      status: 'paid',
      id: routeA.order,
      firstName: 'Ready',
      email: 'ready-order@example.test',
    }));

    const view = renderPurchaseSuccess(routeA);
    expect(screen.getByRole('heading', { name: 'Processing your order...' })).toBeInTheDocument();
    expect(lookupOrder).not.toHaveBeenCalled();

    useServiceLocator.mockReturnValue(readyLocator());
    view.rerender(<App />);
    await flushPurchaseWork();

    expect(lookupOrder).toHaveBeenCalledWith(firebaseApp, {
      orderId: routeA.order,
      token: routeA.token,
    });
    expect(lookupOrder).toHaveBeenCalledTimes(1);
    expect(document.body).toHaveTextContent('ready-order@example.test');
    expect(track).not.toHaveBeenCalled();
  });

  test.each([
    ['order', { ...routeA, order: null }],
    ['token', { ...routeA, token: null }],
  ])('preserves the missing-%s error without starting an order lookup', (_field, route) => {
    renderPurchaseSuccess(route);

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(lookupOrder).not.toHaveBeenCalled();
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
    const buyButton = screen.getByRole('button', { name: 'Buy — $30.00' });
    expect(buyButton).toBeDisabled();
    const form = buyButton.closest('form');
    expect(form).not.toBeNull();
    fireEvent.click(buyButton);
    fireEvent.submit(form);
    expect(createMerchCheckout).toHaveBeenCalledTimes(1);
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
    expect(screen.getByRole('button', { name: 'Buy — $30.00' })).toBeDisabled();
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('locks the page after a checkout result has no usable URL', async () => {
    const unexpectedGetter = jest.fn(() => {
      throw new Error('checkout-result-getter-canary');
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
    createMerchCheckout.mockResolvedValueOnce(Object.defineProperty(
      {
        sessionId: 'synthetic-session',
        orderId: 'synthetic-order',
      },
      'unexpected',
      {
        configurable: true,
        get: unexpectedGetter,
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
    fireEvent.click(screen.getByRole('button', { name: 'Buy — $30.00' }));

    expect((await screen.findByRole('alert')).textContent).toBe(SHOP_CHECKOUT_FAILURE);
    expect(unexpectedGetter).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('checkout-result-getter-canary');
    expect(screen.getByPlaceholderText('First name')).toHaveValue('Synthetic');
    expect(screen.getByPlaceholderText('Last name')).toHaveValue('Buyer');
    expect(screen.getByPlaceholderText('Email')).toHaveValue('buyer@example.test');

    const buyButton = screen.getByRole('button', { name: 'Buy — $30.00' });
    expect(buyButton).toBeDisabled();
    const form = buyButton.closest('form');
    expect(form).not.toBeNull();
    fireEvent.click(buyButton);
    fireEvent.submit(form);

    expect(createMerchCheckout).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/shop/synthetic-product');
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

describe('Admin Event save privacy and one-attempt boundary', () => {
  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

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

  function adminAuth(uid = 'synthetic-admin') {
    return {
      user: uid ? { uid } : null,
      isLoading: false,
      isAuthenticated: true,
      isMember: true,
      isAdmin: true,
      signIn: jest.fn(),
      signOut: jest.fn(),
      register: jest.fn(),
    };
  }

  function fillValidNewEvent() {
    fireEvent.change(screen.getByLabelText('Title *'), {
      target: { value: 'Synthetic New Run' },
    });
    fireEvent.change(screen.getByLabelText('Start *'), {
      target: { value: '2030-01-12T09:30' },
    });
  }

  async function renderLoadedEditor(event = syntheticAdminEvent()) {
    getEventBySlug.mockResolvedValueOnce(event);
    const view = renderAdminEventEditor(event.slug);
    expect(await screen.findByRole('heading', {
      level: 1,
      name: `Edit: ${event.title}`,
    })).toBeInTheDocument();
    return view;
  }

  beforeEach(() => {
    useAuth.mockReturnValue(adminAuth());
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    listAllEvents.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('preserves one exact edit request and the current success navigation', async () => {
    updateEvent.mockResolvedValueOnce(undefined);
    await renderLoadedEditor();

    fireEvent.submit(document.querySelector('form'));

    await waitFor(() => expect(window.location.pathname).toBe('/admin/events'));
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent).toHaveBeenCalledWith(
      firestore,
      'synthetic-event',
      {
        slug: 'synthetic-event',
        title: 'Synthetic Club Run',
        description: 'A made-up event used only for this test.',
        startAt: new Date(2030, 0, 12, 9, 30),
        endAt: new Date(2030, 0, 12, 11, 0),
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
        customFields: [],
        volunteerEnabled: false,
        volunteerFields: [],
        resultsUrl: null,
        resultsText: null,
        registrationOpensAt: null,
        registrationClosesAt: null,
        heroImageUrl: '',
      },
    );
    expect(createEvent).not.toHaveBeenCalled();
  });

  test('preserves one exact create request with the current authenticated UID', async () => {
    createEvent.mockResolvedValueOnce(undefined);
    window.history.pushState({}, '', '/admin/events/new');
    render(<App />);
    fillValidNewEvent();

    fireEvent.submit(document.querySelector('form'));

    await waitFor(() => expect(window.location.pathname).toBe('/admin/events'));
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createEvent).toHaveBeenCalledWith(
      firestore,
      {
        slug: 'synthetic-new-run',
        title: 'Synthetic New Run',
        description: '',
        startAt: new Date(2030, 0, 12, 9, 30),
        endAt: null,
        location: '',
        locationDetails: '',
        capacity: null,
        status: 'draft',
        visibility: 'public',
        pricing: { memberCents: 0, nonMemberCents: 0 },
        waiverText: '',
        waiverVersion: '1',
        customFields: [],
        volunteerEnabled: false,
        volunteerFields: [],
        resultsUrl: null,
        resultsText: null,
        registrationOpensAt: null,
        registrationClosesAt: null,
        heroImageUrl: '',
      },
      'synthetic-admin',
    );
    expect(updateEvent).not.toHaveBeenCalled();
  });

  test('keeps local validation correctable without consuming the save attempt', async () => {
    const request = deferred();
    createEvent.mockReturnValueOnce(request.promise);
    window.history.pushState({}, '', '/admin/events/new');
    render(<App />);

    fireEvent.submit(document.querySelector('form'));
    expect(await screen.findByText('Start date/time is required')).toBeInTheDocument();
    expect(createEvent).not.toHaveBeenCalled();

    fillValidNewEvent();
    fireEvent.submit(document.querySelector('form'));

    expect(await screen.findByRole('status')).toHaveTextContent(ADMIN_EVENT_SAVE_PENDING);
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  test('admits one immediate edit submission and hides the complete form while pending', async () => {
    const request = deferred();
    updateEvent.mockReturnValue(request.promise);
    await renderLoadedEditor();
    const form = document.querySelector('form');

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toBe(ADMIN_EVENT_SAVE_PENDING);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByText('Synthetic Club Run')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /All events/ })).not.toBeInTheDocument();
  });

  test('admits one immediate create submission while pending', async () => {
    const request = deferred();
    createEvent.mockReturnValue(request.promise);
    window.history.pushState({}, '', '/admin/events/new');
    render(<App />);
    fillValidNewEvent();
    const form = document.querySelector('form');

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(screen.getByRole('status').textContent).toBe(ADMIN_EVENT_SAVE_PENDING);
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create event' })).not.toBeInTheDocument();
  });

  test('discards a hostile edit rejection and keeps the same-context page terminally unknown', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const messageGetter = jest.fn(() => 'admin-event-save-message-canary');
    const toStringGetter = jest.fn(() => () => 'admin-event-save-string-canary');
    const getTrap = jest.fn((target, key, receiver) => Reflect.get(target, key, receiver));
    const hostile = new Proxy(Object.defineProperties({}, {
      message: { configurable: true, get: messageGetter },
      toString: { configurable: true, get: toStringGetter },
    }), { get: getTrap });
    updateEvent.mockRejectedValueOnce(hostile);
    const view = await renderLoadedEditor();

    fireEvent.submit(document.querySelector('form'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ADMIN_EVENT_SAVE_UNKNOWN);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(messageGetter).not.toHaveBeenCalled();
    expect(toStringGetter).not.toHaveBeenCalled();
    expect(getTrap).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent(
      /admin-event-save-message-canary|admin-event-save-string-canary/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /admin-event-save-message-canary|admin-event-save-string-canary/i,
    );
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByText('Synthetic Club Run')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /All events/ })).not.toBeInTheDocument();
    expect(updateEvent).toHaveBeenCalledTimes(1);

    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore } },
      isReady: true,
    });
    view.rerender(<App />);
    expect(screen.getByRole('alert').textContent).toBe(ADMIN_EVENT_SAVE_UNKNOWN);
    expect(updateEvent).toHaveBeenCalledTimes(1);
  });

  test('replaces an ordinary create rejection with the same fixed unknown result', async () => {
    updateEvent.mockResolvedValue(undefined);
    createEvent.mockRejectedValueOnce(Object.assign(
      new Error('admin-event-create-private-canary officer@example.test'),
      { endpoint: 'https://provider.example.test/?token=create-secret-canary' },
    ));
    window.history.pushState({}, '', '/admin/events/new');
    render(<App />);
    fillValidNewEvent();

    fireEvent.submit(document.querySelector('form'));

    expect((await screen.findByRole('alert')).textContent).toBe(ADMIN_EVENT_SAVE_UNKNOWN);
    expect(document.body).not.toHaveTextContent(
      /admin-event-create-private-canary|officer@example\.test|provider\.example|create-secret-canary/i,
    );
    expect(document.querySelector('form')).toBeNull();
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(updateEvent).not.toHaveBeenCalled();
  });

  test('performs no create when the current UID or database is missing', async () => {
    useAuth.mockReturnValue(adminAuth(null));
    window.history.pushState({}, '', '/admin/events/new');
    const missingUidView = render(<App />);
    fillValidNewEvent();
    fireEvent.submit(document.querySelector('form'));
    expect(createEvent).not.toHaveBeenCalled();
    missingUidView.unmount();

    useAuth.mockReturnValue(adminAuth());
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: null } },
      isReady: true,
    });
    window.history.replaceState({}, '', '/admin/events/new');
    render(<App />);
    fillValidNewEvent();
    fireEvent.submit(document.querySelector('form'));
    expect(createEvent).not.toHaveBeenCalled();
  });

  test('makes an older success inert after the route changes', async () => {
    const request = deferred();
    updateEvent.mockReturnValueOnce(request.promise);
    await renderLoadedEditor();
    fireEvent.submit(document.querySelector('form'));
    expect(await screen.findByRole('status')).toHaveTextContent(ADMIN_EVENT_SAVE_PENDING);

    getEventBySlug.mockResolvedValueOnce(syntheticAdminEvent({
      slug: 'current-event',
      title: 'Current Synthetic Run',
    }));
    window.history.pushState({}, '', '/admin/events/current-event/edit');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Edit: Current Synthetic Run',
    })).toBeInTheDocument();

    await act(async () => {
      request.resolve(undefined);
      await request.promise;
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe('/admin/events/current-event/edit');
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Edit: Current Synthetic Run',
    })).toBeInTheDocument();
    expect(updateEvent).toHaveBeenCalledTimes(1);
  });

  test('does not inspect an older hostile rejection after the route changes', async () => {
    const request = deferred();
    updateEvent.mockReturnValueOnce(request.promise);
    await renderLoadedEditor();
    fireEvent.submit(document.querySelector('form'));
    expect(await screen.findByRole('status')).toHaveTextContent(ADMIN_EVENT_SAVE_PENDING);

    getEventBySlug.mockResolvedValueOnce(syntheticAdminEvent({
      slug: 'current-event',
      title: 'Current Synthetic Run',
    }));
    window.history.pushState({}, '', '/admin/events/current-event/edit');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Edit: Current Synthetic Run',
    })).toBeInTheDocument();
    const messageGetter = jest.fn(() => 'obsolete-event-save-message-canary');

    await act(async () => {
      request.reject(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await request.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/admin/events/current-event/edit');
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Edit: Current Synthetic Run',
    })).toBeInTheDocument();
  });

  test('makes an older success inert after the database changes', async () => {
    const request = deferred();
    updateEvent.mockReturnValueOnce(request.promise);
    const view = await renderLoadedEditor();
    fireEvent.submit(document.querySelector('form'));
    expect(await screen.findByRole('status')).toHaveTextContent(ADMIN_EVENT_SAVE_PENDING);

    const currentFirestore = { name: 'synthetic-current-save-firestore' };
    getEventBySlug.mockResolvedValueOnce(syntheticAdminEvent({
      title: 'Current Database Run',
    }));
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { firestore: currentFirestore } },
      isReady: true,
    });
    view.rerender(<App />);
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Edit: Current Database Run',
    })).toBeInTheDocument();

    await act(async () => {
      request.resolve(undefined);
      await request.promise;
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe('/admin/events/synthetic-event/edit');
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Edit: Current Database Run',
    })).toBeInTheDocument();
  });

  test('makes an older success inert after the admin UID changes', async () => {
    const request = deferred();
    updateEvent.mockReturnValueOnce(request.promise);
    const view = await renderLoadedEditor();
    fireEvent.submit(document.querySelector('form'));
    expect(await screen.findByRole('status')).toHaveTextContent(ADMIN_EVENT_SAVE_PENDING);

    useAuth.mockReturnValue(adminAuth('synthetic-current-admin'));
    view.rerender(<App />);
    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Edit: Synthetic Club Run',
    })).toBeInTheDocument();

    await act(async () => {
      request.resolve(undefined);
      await request.promise;
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe('/admin/events/synthetic-event/edit');
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Edit: Synthetic Club Run',
    })).toBeInTheDocument();
  });

  test('makes an older success inert after readiness changes', async () => {
    const request = deferred();
    updateEvent.mockReturnValueOnce(request.promise);
    const view = await renderLoadedEditor();
    fireEvent.submit(document.querySelector('form'));
    expect(await screen.findByRole('status')).toHaveTextContent(ADMIN_EVENT_SAVE_PENDING);

    useServiceLocator.mockReturnValue({ services: null, isReady: false });
    view.rerender(<App />);
    expect(await screen.findByText('Loading...')).toBeInTheDocument();

    await act(async () => {
      request.resolve(undefined);
      await request.promise;
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe('/admin/events/synthetic-event/edit');
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  test('makes a completion inert after the editor unmounts', async () => {
    const request = deferred();
    updateEvent.mockReturnValueOnce(request.promise);
    const view = await renderLoadedEditor();
    fireEvent.submit(document.querySelector('form'));
    expect(await screen.findByRole('status')).toHaveTextContent(ADMIN_EVENT_SAVE_PENDING);
    view.unmount();

    await act(async () => {
      request.resolve(undefined);
      await request.promise;
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe('/admin/events/synthetic-event/edit');
    expect(updateEvent).toHaveBeenCalledTimes(1);
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
    expect(screen.queryByRole('button', { name: '+ Late registration — $0 only' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Comp registration' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No registrations')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /^(Refund|Partial|Sub|Cancel|Note|Issue full refund)$/,
    })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', {
      name: /^(Refund full|Partial refund|Cancel|Substitute runner|Add note|Comp registration|Late registration — \$0 only)/,
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
    expect(screen.getByRole('button', { name: '+ Late registration — $0 only' }))
      .toBeInTheDocument();
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

describe('Admin late-registration Payment Link containment', () => {
  function deferred() {
    let reject;
    let resolve;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      reject = rejectPromise;
      resolve = resolvePromise;
    });
    return { promise, reject, resolve };
  }

  function syntheticExistingRegistration() {
    return {
      id: 'synthetic-existing-registration',
      status: 'paid',
      amountCents: 2500,
      signupType: 'participant',
      priceTier: 'member',
      runner: {
        firstName: 'Existing',
        lastName: 'Runner',
        email: 'existing-runner@example.test',
        shirtSize: 'M',
      },
    };
  }

  function setAdminRegistrationContext() {
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
    getEventBySlug.mockResolvedValue({
      id: 'synthetic-event',
      slug: 'synthetic-event',
      title: 'Synthetic Registration Run',
      startAt: { toDate: () => new Date(2030, 0, 12, 9, 30) },
      location: 'Synthetic Registration Park',
      capacity: 40,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 2500, nonMemberCents: 3000 },
    });
    listRegistrationsForEvent.mockResolvedValue([]);
  }

  function submitLateRegistration() {
    fireEvent.click(screen.getByRole('button', {
      name: '+ Late registration — $0 only',
    }));
    fireEvent.change(screen.getByPlaceholderText('First name'), {
      target: { value: 'Synthetic' },
    });
    fireEvent.change(screen.getByPlaceholderText('Last name'), {
      target: { value: 'Runner' },
    });
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'runner@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create $0 registration' }));
  }

  function expectLateRegistrationUnknownState(...privateText) {
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(ADMIN_LATE_REGISTRATION_OUTCOME_UNKNOWN);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByRole('link', { name: /All events/ }))
      .toHaveAttribute('href', '/admin/events');
    expect(document.body).not.toHaveTextContent(
      /Synthetic Registration Run|Synthetic Registration Park|Existing Runner|existing-runner@example\.test/i,
    );
    privateText.forEach((text) => expect(document.body).not.toHaveTextContent(text));
    expect(screen.queryByText('Paid registrations')).not.toBeInTheDocument();
    expect(screen.queryByText('Refunds')).not.toBeInTheDocument();
    expect(screen.queryByText('Gross revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('Refunded amount')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search by name or email...'))
      .not.toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No registrations')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Late registration — $0 only' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Comp registration' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create $0 registration' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Late registration — $0 only' }))
      .not.toBeInTheDocument();
  }

  beforeEach(() => {
    setAdminRegistrationContext();
    jest.spyOn(window, 'prompt').mockImplementation(() => null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('offers only a plainly labeled $0-only late-registration form', async () => {
    renderAdminEventRegistrations();

    fireEvent.click(await screen.findByRole('button', {
      name: '+ Late registration — $0 only',
    }));

    const modal = screen.getByRole('heading', { name: 'Late registration — $0 only' })
      .parentElement;
    expect(modal).not.toBeNull();
    expect(within(modal).getByText(/Paid late registration is NOT AVAILABLE YET/))
      .toBeInTheDocument();
    expect(within(modal).getByText(/legacy system labels this record paid/))
      .toBeInTheDocument();
    expect(within(modal).getByText(
      /does not prove payment or make the entry free, comp, or member-authorized/,
    ))
      .toBeInTheDocument();
    expect(within(modal).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(modal).queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(within(modal).queryByText(/Payment Link generated|Amount \(USD\)|Tier/))
      .not.toBeInTheDocument();
    expect(window.prompt).not.toHaveBeenCalled();
  });

  test('sends exact zero and never exposes an obsolete reusable link result', async () => {
    adminRegistrationAction.mockResolvedValueOnce({
      ok: true,
      registrationId: 'synthetic-zero-registration',
      paymentLink: 'https://obsolete-payment-link.example.test/synthetic',
    });
    renderAdminEventRegistrations();

    fireEvent.click(await screen.findByRole('button', {
      name: '+ Late registration — $0 only',
    }));
    fireEvent.change(screen.getByPlaceholderText('First name'), {
      target: { value: 'Synthetic' },
    });
    fireEvent.change(screen.getByPlaceholderText('Last name'), {
      target: { value: 'Runner' },
    });
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'runner@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create $0 registration' }));

    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledWith(
      firebaseApp,
      {
        eventId: 'synthetic-event',
        registrationId: undefined,
        action: 'add_late_registration',
        payload: {
          registration: {
            runner: {
              firstName: 'Synthetic',
              lastName: 'Runner',
              email: 'runner@example.test',
            },
            priceTier: 'nonMember',
            amountCents: 0,
          },
        },
      },
    ));
    await waitFor(() => expect(screen.queryByRole('heading', {
      name: 'Late registration — $0 only',
    })).not.toBeInTheDocument());
    expect(window.prompt).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('obsolete-payment-link.example.test');
    expect(getEventBySlug).toHaveBeenCalledTimes(2);
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(2);
  });

  test('turns a rejected $0 request into one terminal accessible unknown outcome', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    listRegistrationsForEvent.mockResolvedValueOnce([syntheticExistingRegistration()]);
    adminRegistrationAction.mockRejectedValueOnce(Object.assign(
      new Error('late-registration-private@example.test'),
      {
        code: 'functions/late-registration-private-canary',
        endpoint: 'https://provider.example.test/?token=private-canary',
      },
    ));
    const view = renderAdminEventRegistrations();

    await screen.findByRole('button', { name: '+ Late registration — $0 only' });
    submitLateRegistration();

    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));
    await screen.findByRole('alert');
    expectLateRegistrationUnknownState(
      'late-registration-private@example.test',
      'functions/late-registration-private-canary',
      'provider.example.test',
      'private-canary',
    );
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /late-registration-private|provider\.example\.test|private-canary/i,
    );
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

    view.rerender(<App />);
    await act(async () => Promise.resolve());

    expectLateRegistrationUnknownState();
    expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect, enumerate, coerce, log, or display a hostile rejection', async () => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const rejectionTraps = {
      get: jest.fn(() => {
        throw new Error('late-registration-get-trap-canary');
      }),
      getOwnPropertyDescriptor: jest.fn(() => {
        throw new Error('late-registration-descriptor-trap-canary');
      }),
      getPrototypeOf: jest.fn(() => {
        throw new Error('late-registration-prototype-trap-canary');
      }),
      has: jest.fn(() => {
        throw new Error('late-registration-has-trap-canary');
      }),
      ownKeys: jest.fn(() => {
        throw new Error('late-registration-keys-trap-canary');
      }),
    };
    const hostileRejection = new Proxy({}, rejectionTraps);
    listRegistrationsForEvent.mockResolvedValueOnce([syntheticExistingRegistration()]);
    adminRegistrationAction.mockRejectedValueOnce(hostileRejection);
    renderAdminEventRegistrations();

    await screen.findByRole('button', { name: '+ Late registration — $0 only' });
    submitLateRegistration();

    await screen.findByRole('alert');
    expectLateRegistrationUnknownState(
      'late-registration-get-trap-canary',
      'late-registration-descriptor-trap-canary',
      'late-registration-prototype-trap-canary',
      'late-registration-has-trap-canary',
      'late-registration-keys-trap-canary',
    );
    Object.values(rejectionTraps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('ignores an older hostile rejection after a changed database fully resolves', async () => {
    const actionRequest = deferred();
    const messageGetter = jest.fn(() => {
      throw new Error('obsolete-late-registration-message-canary');
    });
    adminRegistrationAction.mockReturnValueOnce(actionRequest.promise);
    const view = renderAdminEventRegistrations();

    await screen.findByRole('button', { name: '+ Late registration — $0 only' });
    submitLateRegistration();
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));

    const currentFirestore = { name: 'synthetic-current-registration-firestore' };
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app: firebaseApp, firestore: currentFirestore } },
      isReady: true,
    });
    getEventBySlug.mockResolvedValueOnce({
      id: 'synthetic-current-event',
      slug: 'synthetic-event',
      title: 'Current Registration Run',
      startAt: { toDate: () => new Date(2031, 0, 12, 9, 30) },
      location: 'Current Registration Park',
      capacity: 50,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 2600, nonMemberCents: 3100 },
    });
    listRegistrationsForEvent.mockResolvedValueOnce([]);
    view.rerender(<App />);

    expect(await screen.findByRole('heading', {
      level: 1,
      name: 'Current Registration Run',
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Late registration — $0 only' }))
      .toBeEnabled();

    await act(async () => {
      actionRequest.reject(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await actionRequest.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Current Registration Run',
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Late registration — $0 only' }))
      .toBeEnabled();
    expect(document.body).not.toHaveTextContent(
      'obsolete-late-registration-message-canary',
    );
    expect(getEventBySlug).toHaveBeenNthCalledWith(
      2,
      currentFirestore,
      'synthetic-event',
    );
    expect(listRegistrationsForEvent).toHaveBeenNthCalledWith(
      2,
      currentFirestore,
      'synthetic-event',
    );
    expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
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

describe('Admin Orders action unknown-outcome boundary', () => {
  const ACTION_FAILURE = 'We could not confirm that order action. Do not repeat it. Stop and contact the treasurer and platform owner.';

  function syntheticTimestamp(value) {
    const date = new Date(value);
    return { toDate: () => date };
  }

  function syntheticOrder({
    id = 'synthetic-action-order',
    title = 'Synthetic Action Shirt',
    status = 'paid',
    amountCents = 2500,
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
      size: 'M',
      color: 'Blue',
      amountCents,
      currency: 'usd',
      status,
      trackingNumber: null,
      createdAt: syntheticTimestamp('2030-01-12T20:00:00Z'),
    };
  }

  function spyOnBrowserConsole() {
    return ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  }

  function mockDialogs({ prompts = [], confirmations = [] }) {
    const promptSpy = jest.spyOn(window, 'prompt');
    prompts.forEach((answer) => promptSpy.mockReturnValueOnce(answer));
    const confirmSpy = jest.spyOn(window, 'confirm');
    confirmations.forEach((answer) => confirmSpy.mockReturnValueOnce(answer));
    return { promptSpy, confirmSpy };
  }

  async function renderActionableOrders(orders = [
    syntheticOrder(),
    syntheticOrder({
      id: 'synthetic-other-order',
      title: 'Synthetic Other Order',
      status: 'fulfilled',
      amountCents: 3500,
    }),
  ]) {
    listAllOrders.mockResolvedValueOnce(orders);
    renderAdminOrders();
    expect(await screen.findByText(orders[0].productTitle)).toBeInTheDocument();
    return orders;
  }

  function expectEveryOrderActionDisabled() {
    const buttons = screen.getAllByRole('button', {
      name: /^(Fulfill|Refund|Cancel)$/,
    });
    expect(buttons.length).toBeGreaterThan(3);
    buttons.forEach((button) => expect(button).toBeDisabled());
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    {
      label: 'fulfillment',
      buttonName: 'Fulfill',
      prompts: ['SYNTHETIC-TRACKING', 'Synthetic fulfillment note'],
      confirmations: [],
      expected: {
        orderId: 'synthetic-action-order',
        action: 'mark_fulfilled',
        payload: {
          trackingNumber: 'SYNTHETIC-TRACKING',
          note: 'Synthetic fulfillment note',
        },
      },
    },
    {
      label: 'full refund',
      buttonName: 'Refund',
      prompts: [''],
      confirmations: [true],
      expected: {
        orderId: 'synthetic-action-order',
        action: 'refund_full',
        payload: undefined,
      },
    },
    {
      label: 'partial refund',
      buttonName: 'Refund',
      prompts: ['12.34'],
      confirmations: [],
      expected: {
        orderId: 'synthetic-action-order',
        action: 'refund_partial',
        payload: { amountCents: 1234 },
      },
    },
    {
      label: 'cancellation',
      buttonName: 'Cancel',
      prompts: ['Synthetic cancellation reason'],
      confirmations: [true],
      expected: {
        orderId: 'synthetic-action-order',
        action: 'cancel',
        payload: { note: 'Synthetic cancellation reason' },
      },
    },
  ])('redacts an unconfirmed $label and locks every order action', async ({
    label,
    buttonName,
    prompts,
    confirmations,
    expected,
  }) => {
    const consoleSpies = spyOnBrowserConsole();
    const canary = `admin-order-${label.replace(' ', '-')}-private@example.test`;
    adminOrderAction.mockRejectedValueOnce(Object.assign(new Error(canary), {
      code: `functions/admin-order-${label.replace(' ', '-')}-private-canary`,
      endpoint: 'https://provider.example.test/?token=admin-order-secret-canary',
    }));
    const orders = await renderActionableOrders();
    mockDialogs({ prompts, confirmations });

    const actionButton = screen.getAllByRole('button', { name: buttonName })[0];
    fireEvent.click(actionButton);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ACTION_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(adminOrderAction).toHaveBeenCalledWith(firebaseApp, expected);
    expect(adminOrderAction).toHaveBeenCalledTimes(1);
    expect(listAllOrders).toHaveBeenCalledTimes(1);
    expect(screen.getByText(orders[0].productTitle)).toBeInTheDocument();
    expect(screen.getByText(orders[1].productTitle)).toBeInTheDocument();
    expectEveryOrderActionDisabled();
    expect(document.body).not.toHaveTextContent(
      /admin-order-.*private|provider\.example|admin-order-secret-canary/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /admin-order-.*private|provider\.example|admin-order-secret-canary/i,
    );
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

    fireEvent.click(actionButton);
    await act(async () => { await Promise.resolve(); });
    expect(adminOrderAction).toHaveBeenCalledTimes(1);
    expect(listAllOrders).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      label: 'an accessor-backed rejection',
      makeRejectedValue() {
        const messageGetter = jest.fn(() => 'admin-order-accessor-private-canary');
        return {
          value: Object.defineProperty({}, 'message', {
            configurable: true,
            get: messageGetter,
          }),
          probes: [messageGetter],
        };
      },
    },
    {
      label: 'a Proxy rejection',
      makeRejectedValue() {
        const getTrap = jest.fn(() => 'admin-order-proxy-private-canary');
        const ownKeysTrap = jest.fn(() => []);
        const descriptorTrap = jest.fn(() => undefined);
        return {
          value: new Proxy({}, {
            get: getTrap,
            ownKeys: ownKeysTrap,
            getOwnPropertyDescriptor: descriptorTrap,
          }),
          probes: [getTrap, ownKeysTrap, descriptorTrap],
        };
      },
    },
    {
      label: 'a coercible rejection',
      makeRejectedValue() {
        const toString = jest.fn(() => 'admin-order-coercion-private-canary');
        const valueOf = jest.fn(() => 7);
        return { value: { toString, valueOf }, probes: [toString, valueOf] };
      },
    },
    {
      label: 'a primitive rejection',
      makeRejectedValue() {
        return { value: 'admin-order-primitive-private-canary', probes: [] };
      },
    },
  ])('does not inspect or render $label', async ({ makeRejectedValue }) => {
    const consoleSpies = spyOnBrowserConsole();
    const { value, probes } = makeRejectedValue();
    adminOrderAction.mockRejectedValueOnce(value);
    await renderActionableOrders();
    mockDialogs({
      prompts: ['SYNTHETIC-TRACKING', 'Synthetic fulfillment note'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Fulfill' }));

    expect((await screen.findByRole('alert')).textContent).toBe(ACTION_FAILURE);
    probes.forEach((probe) => expect(probe).not.toHaveBeenCalled());
    expect(document.body).not.toHaveTextContent(/admin-order-.*private-canary/i);
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/admin-order-.*private-canary/i);
    expect(adminOrderAction).toHaveBeenCalledTimes(1);
    expect(listAllOrders).toHaveBeenCalledTimes(1);
    expectEveryOrderActionDisabled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('keeps the stop state terminal across a same-page Firestore change', async () => {
    const orders = [syntheticOrder()];
    listAllOrders.mockResolvedValueOnce(orders);
    adminOrderAction.mockRejectedValueOnce(new Error('admin-order-transition-private-canary'));
    const view = renderAdminOrders();
    expect(await screen.findByText(orders[0].productTitle)).toBeInTheDocument();
    mockDialogs({
      prompts: ['SYNTHETIC-TRACKING', 'Synthetic fulfillment note'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fulfill' }));
    expect((await screen.findByRole('alert')).textContent).toBe(ACTION_FAILURE);

    const changedFirestore = { name: 'synthetic-firestore-after-unknown-action' };
    useServiceLocator.mockReturnValue({
      services: {
        firebaseResources: { app: firebaseApp, firestore: changedFirestore },
      },
      isReady: true,
    });
    view.rerender(<App />);
    await act(async () => { await Promise.resolve(); });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(ACTION_FAILURE);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByText(orders[0].productTitle)).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Fulfill|Refund|Cancel)$/ }))
      .not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('admin-order-transition-private-canary');
    expect(listAllOrders).toHaveBeenCalledTimes(1);
    expect(adminOrderAction).toHaveBeenCalledTimes(1);
  });

  test('preserves one successful action and its existing list reload', async () => {
    const initialOrder = syntheticOrder();
    const updatedOrder = syntheticOrder({
      title: 'Synthetic Reloaded Shirt',
      status: 'fulfilled',
    });
    listAllOrders
      .mockResolvedValueOnce([initialOrder])
      .mockResolvedValueOnce([updatedOrder]);
    adminOrderAction.mockResolvedValueOnce({ ok: true });
    renderAdminOrders();
    expect(await screen.findByText(initialOrder.productTitle)).toBeInTheDocument();
    mockDialogs({
      prompts: ['SYNTHETIC-TRACKING', 'Synthetic fulfillment note'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Fulfill' }));

    expect(await screen.findByText(updatedOrder.productTitle)).toBeInTheDocument();
    expect(adminOrderAction).toHaveBeenCalledWith(firebaseApp, {
      orderId: 'synthetic-action-order',
      action: 'mark_fulfilled',
      payload: {
        trackingNumber: 'SYNTHETIC-TRACKING',
        note: 'Synthetic fulfillment note',
      },
    });
    expect(adminOrderAction).toHaveBeenCalledTimes(1);
    expect(listAllOrders).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    screen.getAllByRole('button', { name: /^(Refund|Cancel)$/ })
      .forEach((button) => expect(button).not.toBeDisabled());
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

describe('Admin website-role change unknown-result boundary', () => {
  const ROLE_CHANGE_UNKNOWN = 'We could not confirm that website access change. Do not repeat it. Stop and contact the membership lead and platform owner.';

  function syntheticTimestamp(value) {
    const date = new Date(value);
    return { toDate: () => date };
  }

  function syntheticWebsiteAccount({
    uid = 'synthetic-target-account',
    email = `${uid}@example.test`,
    fullName = 'Synthetic Target Account',
    role = 'member',
    emailVerified = true,
    createdAt = '2030-05-16T20:00:00Z',
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

  function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  function setAdminMembersContext({
    app = firebaseApp,
    database = firestore,
    uid = 'synthetic-current-admin',
  } = {}) {
    useAuth.mockReturnValue({
      user: { uid },
      isLoading: false,
      isAuthenticated: true,
      isMember: true,
      isAdmin: true,
      signIn: jest.fn(),
      signOut: jest.fn(),
      register: jest.fn(),
    });
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app, firestore: database } },
      isReady: true,
    });
  }

  function getAccountRow(email) {
    const emailCell = screen.getByText(email);
    const row = emailCell.closest('tr');
    expect(row).not.toBeNull();
    return row;
  }

  function getRoleButton(email, role) {
    return within(getAccountRow(email)).getByRole('button', { name: role });
  }

  function expectGenericAdminMembersShell() {
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Website accounts',
    })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Admin home/ }))
      .toHaveAttribute('href', '/admin');
    expect(window.location.pathname).toBe('/admin/members');
  }

  function expectAccountResultsToBeHidden(accounts) {
    accounts.forEach((account) => {
      expect(screen.queryByText(account.fullName)).not.toBeInTheDocument();
      expect(screen.queryByText(account.email)).not.toBeInTheDocument();
    });
    [
      'Admin website access',
      'Member website access',
      'Pending website verification',
      'Total website accounts',
    ].forEach((label) => {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    });
    expect(screen.queryByPlaceholderText('Search by name or email...'))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No website accounts matched')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', {
      name: /^(admin|member|unverified)$/i,
    })).toHaveLength(0);
  }

  function spyOnBrowserConsole() {
    return ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  }

  const targetAccount = syntheticWebsiteAccount();
  const otherAccount = syntheticWebsiteAccount({
    uid: 'synthetic-other-account',
    fullName: 'Synthetic Other Account',
    role: 'unverified',
    createdAt: '2030-06-17T20:00:00Z',
  });
  const initialAccounts = [targetAccount, otherAccount];

  beforeEach(() => {
    setAdminMembersContext();
    listAllMembers.mockResolvedValue(initialAccounts);
    setMemberRole.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('replaces an ordinary rejected role request with one fixed private terminal result', async () => {
    const consoleSpies = spyOnBrowserConsole();
    setMemberRole.mockRejectedValueOnce(Object.assign(
      new Error('role-change-private-canary officer@example.test'),
      {
        code: 'functions/role-change-private-canary',
        endpoint: 'https://provider.example.test/?token=role-change-secret-canary',
      },
    ));

    renderAdminMembers();
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();
    fireEvent.click(getRoleButton(targetAccount.email, 'admin'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ROLE_CHANGE_UNKNOWN);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expectGenericAdminMembersShell();
    expectAccountResultsToBeHidden(initialAccounts);
    expect(document.body).not.toHaveTextContent(
      /role-change-private-canary|officer@example\.test|provider\.example|role-change-secret-canary/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /role-change-private-canary|officer@example\.test|provider\.example|role-change-secret-canary/i,
    );
    expect(track).not.toHaveBeenCalled();
    expect(setMemberRole).toHaveBeenCalledWith(
      firebaseApp,
      targetAccount.email,
      'admin',
    );
    expect(setMemberRole).toHaveBeenCalledTimes(1);
    expect(listAllMembers).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test.each([
    [
      'primitive',
      () => ({
        rejection: 'primitive-role-change-private-canary',
        probes: [],
      }),
    ],
    [
      'accessor-backed',
      () => {
        const messageGetter = jest.fn(() => 'accessor-role-change-private-canary');
        return {
          rejection: Object.defineProperty({}, 'message', {
            configurable: true,
            get: messageGetter,
          }),
          probes: [messageGetter],
        };
      },
    ],
    [
      'Proxy',
      () => {
        const getTrap = jest.fn((_target, property) => (
          property === 'message' ? 'proxy-role-change-private-canary' : undefined
        ));
        return {
          rejection: new Proxy({}, { get: getTrap }),
          probes: [getTrap],
        };
      },
    ],
    [
      'coercible',
      () => {
        const toString = jest.fn(() => 'coercible-role-change-private-canary');
        const valueOf = jest.fn(() => 'coercible-role-change-value-canary');
        return {
          rejection: { toString, valueOf },
          probes: [toString, valueOf],
        };
      },
    ],
  ])('does not inspect, log, measure, or render a %s rejected value', async (
    _label,
    createRejection,
  ) => {
    const consoleSpies = spyOnBrowserConsole();
    const { rejection, probes } = createRejection();
    setMemberRole.mockRejectedValueOnce(rejection);

    renderAdminMembers();
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();
    fireEvent.click(getRoleButton(targetAccount.email, 'admin'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ROLE_CHANGE_UNKNOWN);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    probes.forEach((probe) => expect(probe).not.toHaveBeenCalled());
    expectAccountResultsToBeHidden(initialAccounts);
    expect(document.body).not.toHaveTextContent(
      /primitive-role-change|accessor-role-change|proxy-role-change|coercible-role-change/i,
    );
    expect(JSON.stringify(track.mock.calls)).not.toMatch(
      /primitive-role-change|accessor-role-change|proxy-role-change|coercible-role-change/i,
    );
    expect(track).not.toHaveBeenCalled();
    expect(setMemberRole).toHaveBeenCalledTimes(1);
    expect(listAllMembers).toHaveBeenCalledTimes(1);
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('disables every role-action button while one request is pending', async () => {
    const pending = createDeferred();
    setMemberRole.mockReturnValue(pending.promise);
    const view = renderAdminMembers();
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();

    fireEvent.click(getRoleButton(targetAccount.email, 'admin'));

    await waitFor(() => expect(setMemberRole).toHaveBeenCalledTimes(1));
    const roleButtons = screen.getAllByRole('button', {
      name: /^(\.\.\.|admin|member|unverified)$/i,
    });
    expect(roleButtons.length).toBeGreaterThan(2);
    roleButtons.forEach((button) => expect(button).toBeDisabled());
    expect(listAllMembers).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test('blocks rapid repeats on the target row and every other row', async () => {
    const pending = createDeferred();
    setMemberRole.mockReturnValue(pending.promise);
    const view = renderAdminMembers();
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();

    const targetButton = getRoleButton(targetAccount.email, 'admin');
    const otherMemberButton = getRoleButton(otherAccount.email, 'member');
    const otherAdminButton = getRoleButton(otherAccount.email, 'admin');
    fireEvent.click(targetButton);
    fireEvent.click(targetButton);
    fireEvent.click(otherMemberButton);
    fireEvent.click(otherAdminButton);

    await waitFor(() => expect(setMemberRole).toHaveBeenCalledTimes(1));
    expect(setMemberRole).toHaveBeenCalledWith(
      firebaseApp,
      targetAccount.email,
      'admin',
    );
    expect(listAllMembers).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test('does not expose a same-page retry or reload after the role outcome becomes unknown', async () => {
    const pending = createDeferred();
    setMemberRole
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ ok: true });
    renderAdminMembers();
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();
    fireEvent.click(getRoleButton(targetAccount.email, 'admin'));
    await waitFor(() => expect(setMemberRole).toHaveBeenCalledTimes(1));

    await act(async () => {
      pending.reject(new Error('repeat-role-change-private-canary'));
      await Promise.resolve();
    });

    const samePageRetries = screen.queryAllByRole('button', { name: 'admin' });
    if (samePageRetries[0]) fireEvent.click(samePageRetries[0]);
    await act(async () => { await Promise.resolve(); });

    expect(setMemberRole).toHaveBeenCalledTimes(1);
    expect(listAllMembers).toHaveBeenCalledTimes(1);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(ROLE_CHANGE_UNKNOWN);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expectAccountResultsToBeHidden(initialAccounts);
    expect(document.body).not.toHaveTextContent('repeat-role-change-private-canary');
  });

  test.each([
    [
      'Firebase app',
      {
        app: { name: 'synthetic-current-app' },
        database: firestore,
        uid: 'synthetic-current-admin',
        expectedListCalls: 1,
      },
    ],
    [
      'Firestore object',
      {
        app: firebaseApp,
        database: { name: 'synthetic-current-firestore' },
        uid: 'synthetic-current-admin',
        expectedListCalls: 2,
      },
    ],
    [
      'admin UID',
      {
        app: firebaseApp,
        database: firestore,
        uid: 'synthetic-current-admin-two',
        expectedListCalls: 1,
      },
    ],
  ])('ignores an obsolete hostile rejection after the %s changes', async (
    _label,
    nextContext,
  ) => {
    const consoleSpies = spyOnBrowserConsole();
    const pending = createDeferred();
    setMemberRole.mockReturnValueOnce(pending.promise);
    const view = renderAdminMembers();
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();
    fireEvent.click(getRoleButton(targetAccount.email, 'admin'));
    await waitFor(() => expect(setMemberRole).toHaveBeenCalledTimes(1));

    setAdminMembersContext(nextContext);
    view.rerender(<App />);
    await waitFor(() => {
      expect(listAllMembers).toHaveBeenCalledTimes(nextContext.expectedListCalls);
    });
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();

    const messageGetter = jest.fn(() => 'obsolete-role-change-private-canary');
    await act(async () => {
      pending.reject(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.getByText(targetAccount.fullName)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('obsolete-role-change-private-canary');
    expect(setMemberRole).toHaveBeenCalledTimes(1);
    expect(listAllMembers).toHaveBeenCalledTimes(nextContext.expectedListCalls);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test.each([
    [
      'Firebase app',
      {
        app: { name: 'synthetic-current-success-app' },
        database: firestore,
        uid: 'synthetic-current-admin',
        expectedListCalls: 1,
      },
    ],
    [
      'admin UID',
      {
        app: firebaseApp,
        database: firestore,
        uid: 'synthetic-current-success-admin',
        expectedListCalls: 1,
      },
    ],
  ])('does not reload for an obsolete resolution after the %s changes', async (
    _label,
    nextContext,
  ) => {
    const pending = createDeferred();
    setMemberRole.mockReturnValueOnce(pending.promise);
    const view = renderAdminMembers();
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();
    fireEvent.click(getRoleButton(targetAccount.email, 'admin'));
    await waitFor(() => expect(setMemberRole).toHaveBeenCalledTimes(1));

    setAdminMembersContext(nextContext);
    view.rerender(<App />);
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();

    await act(async () => {
      pending.resolve({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setMemberRole).toHaveBeenCalledTimes(1);
    expect(listAllMembers).toHaveBeenCalledTimes(nextContext.expectedListCalls);
    expect(screen.getByText(targetAccount.fullName)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('does not revive an old pending result after the app context changes away and back', async () => {
    const consoleSpies = spyOnBrowserConsole();
    const pending = createDeferred();
    const otherApp = { name: 'synthetic-round-trip-app' };
    setMemberRole.mockReturnValueOnce(pending.promise);
    const view = renderAdminMembers();
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();
    fireEvent.click(getRoleButton(targetAccount.email, 'admin'));
    await waitFor(() => expect(setMemberRole).toHaveBeenCalledTimes(1));

    setAdminMembersContext({ app: otherApp });
    view.rerender(<App />);
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
    expect(screen.getByText(targetAccount.fullName)).toBeInTheDocument();

    setAdminMembersContext({ app: firebaseApp });
    view.rerender(<App />);
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
    expect(screen.getByText(targetAccount.fullName)).toBeInTheDocument();
    expect(getRoleButton(targetAccount.email, 'admin')).toBeEnabled();

    const messageGetter = jest.fn(() => 'round-trip-role-change-private-canary');
    await act(async () => {
      pending.reject(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.getByText(targetAccount.fullName)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('round-trip-role-change-private-canary');
    expect(setMemberRole).toHaveBeenCalledTimes(1);
    expect(listAllMembers).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('ignores a hostile role rejection after the page unmounts', async () => {
    const consoleSpies = spyOnBrowserConsole();
    const pending = createDeferred();
    setMemberRole.mockReturnValueOnce(pending.promise);
    const view = renderAdminMembers();
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();
    fireEvent.click(getRoleButton(targetAccount.email, 'admin'));
    await waitFor(() => expect(setMemberRole).toHaveBeenCalledTimes(1));
    view.unmount();

    const messageGetter = jest.fn(() => 'unmounted-role-change-private-canary');
    await act(async () => {
      pending.reject(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(listAllMembers).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not reload after a role request resolves on an unmounted page', async () => {
    const pending = createDeferred();
    setMemberRole.mockReturnValueOnce(pending.promise);
    const view = renderAdminMembers();
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();
    fireEvent.click(getRoleButton(targetAccount.email, 'admin'));
    await waitFor(() => expect(setMemberRole).toHaveBeenCalledTimes(1));
    view.unmount();

    await act(async () => {
      pending.resolve({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setMemberRole).toHaveBeenCalledTimes(1);
    expect(listAllMembers).toHaveBeenCalledTimes(1);
  });

  test('preserves one successful exact role request and exactly one list reload', async () => {
    const refreshedAccount = syntheticWebsiteAccount({
      role: 'admin',
      fullName: 'Synthetic Refreshed Account',
    });
    listAllMembers
      .mockResolvedValueOnce(initialAccounts)
      .mockResolvedValueOnce([refreshedAccount, otherAccount]);
    setMemberRole.mockResolvedValueOnce({ ok: true });
    renderAdminMembers();
    expect(await screen.findByText(targetAccount.fullName)).toBeInTheDocument();

    fireEvent.click(getRoleButton(targetAccount.email, 'admin'));

    expect(await screen.findByText(refreshedAccount.fullName)).toBeInTheDocument();
    expect(screen.queryByText(targetAccount.fullName)).not.toBeInTheDocument();
    expect(screen.getByText(refreshedAccount.email)).toBeInTheDocument();
    expect(setMemberRole).toHaveBeenCalledWith(
      firebaseApp,
      targetAccount.email,
      'admin',
    );
    expect(setMemberRole).toHaveBeenCalledTimes(1);
    expect(listAllMembers).toHaveBeenNthCalledWith(1, firestore);
    expect(listAllMembers).toHaveBeenNthCalledWith(2, firestore);
    expect(listAllMembers).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
  });
});

describe('Admin registration action unknown-result boundary', () => {
  const ACTION_UNKNOWN = 'We could not confirm that registration action. Do not repeat it. Stop and contact the event lead, treasurer, and platform owner.';
  const primaryRegistration = {
    id: 'synthetic-primary-registration',
    status: 'paid',
    amountCents: 2500,
    signupType: 'participant',
    priceTier: 'member',
    runner: {
      firstName: 'Synthetic',
      lastName: 'Primary',
      email: 'synthetic-primary@example.test',
      shirtSize: 'M',
    },
  };
  const secondaryRegistration = {
    id: 'synthetic-secondary-registration',
    status: 'paid',
    amountCents: 3000,
    signupType: 'participant',
    priceTier: 'nonMember',
    runner: {
      firstName: 'Synthetic',
      lastName: 'Secondary',
      email: 'synthetic-secondary@example.test',
      shirtSize: 'L',
    },
  };

  function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, reject, resolve };
  }

  function syntheticActionEvent({
    title = 'Synthetic Action Run',
    slug = 'synthetic-event',
  } = {}) {
    return {
      id: slug,
      slug,
      title,
      startAt: { toDate: () => new Date(2030, 0, 12, 9, 30) },
      location: 'Synthetic Action Park',
      capacity: 40,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 2500, nonMemberCents: 3000 },
    };
  }

  function setRegistrationActionContext({
    app = firebaseApp,
    db = firestore,
    uid = 'synthetic-admin',
  } = {}) {
    useAuth.mockReturnValue({
      user: { uid },
      isLoading: false,
      isAuthenticated: true,
      isMember: true,
      isAdmin: true,
      signIn: jest.fn(),
      signOut: jest.fn(),
      register: jest.fn(),
    });
    useServiceLocator.mockReturnValue({
      services: { firebaseResources: { app, firestore: db } },
      isReady: true,
    });
  }

  function spyOnBrowserConsole() {
    return ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
  }

  function rowFor(email) {
    const row = screen.getByText(email).closest('tr');
    expect(row).not.toBeNull();
    return row;
  }

  function fillRunnerDraft() {
    fireEvent.change(screen.getByPlaceholderText('First name'), {
      target: { value: 'Replacement' },
    });
    fireEvent.change(screen.getByPlaceholderText('Last name'), {
      target: { value: 'Runner' },
    });
    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'replacement@example.test' },
    });
  }

  function startRegistrationAction(kind, registration = primaryRegistration) {
    const row = rowFor(registration.runner.email);
    if (kind === 'refund_full') {
      fireEvent.click(within(row).getByRole('button', { name: 'Refund' }));
      fireEvent.click(screen.getByRole('button', { name: 'Issue full refund' }));
      return;
    }
    if (kind === 'refund_partial') {
      fireEvent.click(within(row).getByRole('button', { name: 'Partial' }));
      fireEvent.change(screen.getByRole('spinbutton'), {
        target: { value: '5.25' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Issue partial refund' }));
      return;
    }
    if (kind === 'cancel') {
      fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
      fireEvent.change(screen.getByLabelText('Note (optional)'), {
        target: { value: 'Synthetic cancellation note' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel registration' }));
      return;
    }
    if (kind === 'substitute') {
      fireEvent.click(within(row).getByRole('button', { name: 'Sub' }));
      fillRunnerDraft();
      fireEvent.click(screen.getByRole('button', { name: 'Substitute' }));
      return;
    }
    if (kind === 'add_note') {
      fireEvent.click(within(row).getByRole('button', { name: 'Note' }));
      fireEvent.change(screen.getByPlaceholderText('Note...'), {
        target: { value: 'Synthetic registration note' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
      return;
    }
    fireEvent.click(screen.getByRole('button', { name: '+ Comp registration' }));
    fillRunnerDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Create comp' }));
  }

  function expectUnknownRegistrationShell(...privateText) {
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(ACTION_UNKNOWN);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByRole('link', { name: /All events/ }))
      .toHaveAttribute('href', '/admin/events');
    expect(document.body).not.toHaveTextContent(
      /Synthetic Action Run|Synthetic Action Park|synthetic-primary@example\.test|synthetic-secondary@example\.test/i,
    );
    privateText.forEach((text) => expect(document.body).not.toHaveTextContent(text));
    expect(screen.queryByText('Paid registrations')).not.toBeInTheDocument();
    expect(screen.queryByText('Refunds')).not.toBeInTheDocument();
    expect(screen.queryByText('Gross revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('Refunded amount')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search by name or email...'))
      .not.toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Late registration — $0 only' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Comp registration' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export CSV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /^(Refund|Partial|Sub|Cancel|Note|Issue full refund|Issue partial refund|Cancel registration|Substitute|Add note|Create comp)$/,
    })).not.toBeInTheDocument();
  }

  beforeEach(() => {
    setRegistrationActionContext();
    getEventBySlug.mockResolvedValue(syntheticActionEvent());
    listRegistrationsForEvent.mockResolvedValue([
      primaryRegistration,
      secondaryRegistration,
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [
      'refund_full',
      primaryRegistration.id,
      {},
      'refund_full',
      /Refund full — synthetic-primary@example\.test/,
      'Issue full refund',
    ],
    [
      'refund_partial',
      primaryRegistration.id,
      { amountCents: 525 },
      'refund_partial',
      /Partial refund — synthetic-primary@example\.test/,
      'Issue partial refund',
    ],
    [
      'cancel',
      primaryRegistration.id,
      { note: 'Synthetic cancellation note' },
      'cancel',
      /Cancel — synthetic-primary@example\.test/,
      'Cancel registration',
    ],
    ['substitute', primaryRegistration.id, {
      newRunner: {
        firstName: 'Replacement',
        lastName: 'Runner',
        email: 'replacement@example.test',
      },
    }, 'substitute', /Substitute runner — was synthetic-primary@example\.test/, 'Substitute'],
    ['add_note', primaryRegistration.id, {
      note: 'Synthetic registration note',
    }, 'add_note', 'Add note', 'Add note'],
    ['mark_comp', undefined, {
      registration: {
        runner: {
          firstName: 'Replacement',
          lastName: 'Runner',
          email: 'replacement@example.test',
        },
      },
    }, 'mark_comp', 'Comp registration', 'Create comp'],
  ])('preserves the exact %s request and performs one current reload', async (
    kind,
    registrationId,
    payload,
    action,
    modalHeading,
    submitLabel,
  ) => {
    adminRegistrationAction.mockResolvedValueOnce({ ok: true });
    renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();

    startRegistrationAction(kind);

    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledWith(
      firebaseApp,
      {
        eventId: 'synthetic-event',
        registrationId,
        action,
        payload,
      },
    ));
    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenCalledTimes(2));
    expect(getEventBySlug).toHaveBeenCalledTimes(2);
    expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Working...' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: modalHeading })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: submitLabel })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Late registration — $0 only' }))
      .toBeEnabled();
    expect(screen.getByRole('button', { name: '+ Comp registration' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    ['Refund', 'Partial', 'Sub', 'Cancel', 'Note'].forEach((name) => {
      expect(within(rowFor(primaryRegistration.runner.email))
        .getByRole('button', { name })).toBeEnabled();
    });
    expect(track).not.toHaveBeenCalled();
  });

  test('returns to idle and allows one later deliberate action after the reload', async () => {
    adminRegistrationAction
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();

    startRegistrationAction('add_note');
    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(within(rowFor(primaryRegistration.runner.email))
      .getByRole('button', { name: 'Cancel' })).toBeEnabled();

    startRegistrationAction('cancel');

    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenCalledTimes(3));
    expect(adminRegistrationAction).toHaveBeenNthCalledWith(
      1,
      firebaseApp,
      {
        eventId: 'synthetic-event',
        registrationId: primaryRegistration.id,
        action: 'add_note',
        payload: { note: 'Synthetic registration note' },
      },
    );
    expect(adminRegistrationAction).toHaveBeenNthCalledWith(
      2,
      firebaseApp,
      {
        eventId: 'synthetic-event',
        registrationId: primaryRegistration.id,
        action: 'cancel',
        payload: { note: 'Synthetic cancellation note' },
      },
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('blocks every mutation and export entry point while one request is pending', async () => {
    const pending = createDeferred();
    adminRegistrationAction.mockReturnValueOnce(pending.promise);
    const originalFetch = global.fetch;
    global.fetch = jest.fn();
    const view = renderAdminEventRegistrations();
    try {
      expect(await screen.findByText(primaryRegistration.runner.email))
        .toBeInTheDocument();

      fireEvent.click(within(rowFor(primaryRegistration.runner.email))
        .getByRole('button', { name: 'Refund' }));
      const submit = screen.getByRole('button', { name: 'Issue full refund' });
      const differentRowNote = within(rowFor(secondaryRegistration.runner.email))
        .getByRole('button', { name: 'Note' });
      const lateRegistration = screen.getByRole('button', {
        name: '+ Late registration — $0 only',
      });
      const compRegistration = screen.getByRole('button', {
        name: '+ Comp registration',
      });
      const exportCsv = screen.getByRole('button', { name: 'Export CSV' });
      act(() => {
        submit.click();
        submit.click();
        differentRowNote.click();
        lateRegistration.click();
        compRegistration.click();
        exportCsv.click();
      });
      await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));

      expect(screen.getByRole('status')).toHaveTextContent(
        'Registration action in progress. Do not start another action.',
      );
      expect(screen.getByRole('button', { name: 'Working...' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '+ Late registration — $0 only' }))
        .toBeDisabled();
      expect(screen.getByRole('button', { name: '+ Comp registration' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
      [primaryRegistration, secondaryRegistration].forEach((registration) => {
        const row = rowFor(registration.runner.email);
        ['Refund', 'Partial', 'Sub', 'Cancel', 'Note'].forEach((name) => {
          expect(within(row).getByRole('button', { name })).toBeDisabled();
        });
      });

      expect(screen.getByRole('heading', {
        name: /Refund full — synthetic-primary@example\.test/,
      })).toBeInTheDocument();
      expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      pending.resolve({ ok: true });
      await pending.promise;
      if (originalFetch === undefined) delete global.fetch;
      else global.fetch = originalFetch;
    }
  });

  test('turns an ordinary rejection into one terminal private unknown outcome', async () => {
    const consoleSpies = spyOnBrowserConsole();
    adminRegistrationAction.mockRejectedValueOnce(Object.assign(
      new Error('registration-action-private@example.test'),
      {
        code: 'functions/registration-action-private-canary',
        endpoint: 'https://provider.example.test/?token=registration-action-secret',
      },
    ));
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();

    startRegistrationAction('refund_full');

    await screen.findByRole('alert');
    expectUnknownRegistrationShell(
      'registration-action-private@example.test',
      'functions/registration-action-private-canary',
      'provider.example.test',
      'registration-action-secret',
    );
    expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
    expect(getEventBySlug).toHaveBeenCalledTimes(1);
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());

    view.rerender(<App />);
    await act(async () => Promise.resolve());
    expectUnknownRegistrationShell();
    expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
  });

  test('does not inspect, coerce, enumerate, log, or display a hostile rejection', async () => {
    const consoleSpies = spyOnBrowserConsole();
    const rejectionTraps = {
      get: jest.fn(() => {
        throw new Error('registration-action-get-trap-canary');
      }),
      getOwnPropertyDescriptor: jest.fn(() => {
        throw new Error('registration-action-descriptor-trap-canary');
      }),
      getPrototypeOf: jest.fn(() => {
        throw new Error('registration-action-prototype-trap-canary');
      }),
      has: jest.fn(() => {
        throw new Error('registration-action-has-trap-canary');
      }),
      ownKeys: jest.fn(() => {
        throw new Error('registration-action-keys-trap-canary');
      }),
    };
    adminRegistrationAction.mockRejectedValueOnce(new Proxy({}, rejectionTraps));
    renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();

    startRegistrationAction('add_note');

    await screen.findByRole('alert');
    expectUnknownRegistrationShell(
      'registration-action-get-trap-canary',
      'registration-action-descriptor-trap-canary',
      'registration-action-prototype-trap-canary',
      'registration-action-has-trap-canary',
      'registration-action-keys-trap-canary',
    );
    Object.values(rejectionTraps).forEach((trap) => expect(trap).not.toHaveBeenCalled());
    expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('does not inspect accessor-backed or coercible rejection values', async () => {
    const consoleSpies = spyOnBrowserConsole();
    const messageGetter = jest.fn(() => {
      throw new Error('registration-action-accessor-canary');
    });
    const toString = jest.fn(() => 'registration-action-string-canary');
    const valueOf = jest.fn(() => 41);
    const toPrimitive = jest.fn(() => 'registration-action-primitive-canary');
    const rejection = Object.defineProperties({}, {
      message: {
        configurable: true,
        get: messageGetter,
      },
      toString: {
        configurable: true,
        value: toString,
      },
      valueOf: {
        configurable: true,
        value: valueOf,
      },
      [Symbol.toPrimitive]: {
        configurable: true,
        value: toPrimitive,
      },
    });
    adminRegistrationAction.mockRejectedValueOnce(rejection);
    renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();

    startRegistrationAction('substitute');

    await screen.findByRole('alert');
    expectUnknownRegistrationShell(
      'registration-action-accessor-canary',
      'registration-action-string-canary',
      'registration-action-primitive-canary',
    );
    [messageGetter, toString, valueOf, toPrimitive]
      .forEach((trap) => expect(trap).not.toHaveBeenCalled());
    expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test.each([
    undefined,
    null,
    false,
    17,
    'registration-action-primitive-private-canary',
  ])('maps primitive rejection %# to the same fixed unknown outcome', async (rejection) => {
    adminRegistrationAction.mockRejectedValueOnce(rejection);
    renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();

    startRegistrationAction('cancel');

    await screen.findByRole('alert');
    expectUnknownRegistrationShell('registration-action-primitive-private-canary');
    expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
  });

  test('ignores an older rejection after an A to B to A database cycle', async () => {
    const consoleSpies = spyOnBrowserConsole();
    const pending = createDeferred();
    adminRegistrationAction.mockReturnValueOnce(pending.promise);
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();
    startRegistrationAction('refund_full');
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));

    const otherFirestore = { name: 'synthetic-other-action-firestore' };
    getEventBySlug.mockResolvedValueOnce(syntheticActionEvent({
      title: 'Synthetic Other Action Run',
    }));
    listRegistrationsForEvent.mockResolvedValueOnce([secondaryRegistration]);
    setRegistrationActionContext({ db: otherFirestore });
    view.rerender(<App />);
    expect(await screen.findByRole('heading', {
      name: 'Synthetic Other Action Run',
    })).toBeInTheDocument();

    getEventBySlug.mockResolvedValueOnce(syntheticActionEvent({
      title: 'Synthetic Current Action Run',
    }));
    listRegistrationsForEvent.mockResolvedValueOnce([primaryRegistration]);
    setRegistrationActionContext();
    view.rerender(<App />);
    expect(await screen.findByRole('heading', {
      name: 'Synthetic Current Action Run',
    })).toBeInTheDocument();

    const messageGetter = jest.fn(() => {
      throw new Error('obsolete-registration-action-message-canary');
    });
    await act(async () => {
      pending.reject(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await pending.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(primaryRegistration.runner.email)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      'obsolete-registration-action-message-canary',
    );
    expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('ignores an older resolution after an A to B to A database cycle', async () => {
    const pending = createDeferred();
    adminRegistrationAction.mockReturnValueOnce(pending.promise);
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();
    startRegistrationAction('refund_full');
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));

    const otherFirestore = { name: 'synthetic-resolution-other-firestore' };
    getEventBySlug
      .mockResolvedValueOnce(syntheticActionEvent({
        title: 'Synthetic Resolution Other Run',
      }))
      .mockResolvedValueOnce(syntheticActionEvent({
        title: 'Synthetic Resolution Current Run',
      }));
    listRegistrationsForEvent
      .mockResolvedValueOnce([secondaryRegistration])
      .mockResolvedValueOnce([primaryRegistration]);
    setRegistrationActionContext({ db: otherFirestore });
    view.rerender(<App />);
    expect(await screen.findByRole('heading', {
      name: 'Synthetic Resolution Other Run',
    })).toBeInTheDocument();

    setRegistrationActionContext();
    view.rerender(<App />);
    expect(await screen.findByRole('heading', {
      name: 'Synthetic Resolution Current Run',
    })).toBeInTheDocument();
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(3);

    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
      await Promise.resolve();
    });

    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('heading', {
      name: 'Synthetic Resolution Current Run',
    })).toBeInTheDocument();
    expect(screen.getByText(primaryRegistration.runner.email)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('ignores an older resolution after the Firebase app changes', async () => {
    const pending = createDeferred();
    adminRegistrationAction.mockReturnValueOnce(pending.promise);
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();
    startRegistrationAction('refund_full');
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));

    const currentApp = { name: 'synthetic-current-action-app' };
    getEventBySlug.mockResolvedValueOnce(syntheticActionEvent({
      title: 'Synthetic Current App Run',
    }));
    listRegistrationsForEvent.mockResolvedValueOnce([secondaryRegistration]);
    setRegistrationActionContext({ app: currentApp });
    view.rerender(<App />);
    expect(await screen.findByRole('heading', {
      name: 'Synthetic Current App Run',
    })).toBeInTheDocument();

    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
      await Promise.resolve();
    });

    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(2);
    expect(screen.getByText(secondaryRegistration.runner.email)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('ignores an older resolution after the event route changes', async () => {
    const pending = createDeferred();
    adminRegistrationAction.mockReturnValueOnce(pending.promise);
    renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();
    startRegistrationAction('refund_full');
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));

    getEventBySlug.mockResolvedValueOnce(syntheticActionEvent({
      slug: 'synthetic-current-action-event',
      title: 'Synthetic Current Route Action Run',
    }));
    listRegistrationsForEvent.mockResolvedValueOnce([secondaryRegistration]);
    window.history.pushState(
      {},
      '',
      '/admin/events/synthetic-current-action-event/registrations',
    );
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', {
      name: 'Synthetic Current Route Action Run',
    })).toBeInTheDocument();

    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
      await Promise.resolve();
    });

    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(2);
    expect(listRegistrationsForEvent).toHaveBeenNthCalledWith(
      2,
      firestore,
      'synthetic-current-action-event',
    );
    expect(screen.getByText(secondaryRegistration.runner.email)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('keeps a newer pending action locked when an older action resolves', async () => {
    const olderAction = createDeferred();
    const newerAction = createDeferred();
    adminRegistrationAction
      .mockReturnValueOnce(olderAction.promise)
      .mockReturnValueOnce(newerAction.promise);
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();
    startRegistrationAction('refund_full');
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));

    const otherFirestore = { name: 'synthetic-newer-action-firestore' };
    setRegistrationActionContext({ db: otherFirestore });
    view.rerender(<App />);
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();
    setRegistrationActionContext();
    view.rerender(<App />);
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();

    startRegistrationAction('add_note');
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Registration action in progress. Do not start another action.',
    );

    await act(async () => {
      olderAction.resolve({ ok: true });
      await olderAction.promise;
      await Promise.resolve();
    });

    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Registration action in progress. Do not start another action.',
    );
    expect(screen.getByRole('button', { name: 'Working...' })).toBeDisabled();
    expect(adminRegistrationAction).toHaveBeenCalledTimes(2);

    view.unmount();
    newerAction.resolve({ ok: true });
    await newerAction.promise;
  });

  test('ignores an older attempt after a context cycle and a later successful action', async () => {
    const olderAction = createDeferred();
    adminRegistrationAction
      .mockReturnValueOnce(olderAction.promise)
      .mockResolvedValueOnce({ ok: true });
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();
    startRegistrationAction('refund_full');
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));

    const otherFirestore = { name: 'synthetic-action-attempt-firestore' };
    setRegistrationActionContext({ db: otherFirestore });
    view.rerender(<App />);
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();

    setRegistrationActionContext();
    view.rerender(<App />);
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();
    startRegistrationAction('add_note');
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listRegistrationsForEvent).toHaveBeenCalledTimes(4));

    const messageGetter = jest.fn(() => {
      throw new Error('obsolete-registration-attempt-message-canary');
    });
    await act(async () => {
      olderAction.reject(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await olderAction.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(primaryRegistration.runner.email)).toBeInTheDocument();
    expect(adminRegistrationAction).toHaveBeenCalledTimes(2);
  });

  test('ignores a hostile rejection after the page unmounts', async () => {
    const consoleSpies = spyOnBrowserConsole();
    const pending = createDeferred();
    adminRegistrationAction.mockReturnValueOnce(pending.promise);
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();
    startRegistrationAction('substitute');
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));
    view.unmount();

    const messageGetter = jest.fn(() => {
      throw new Error('unmounted-registration-action-message-canary');
    });
    await act(async () => {
      pending.reject(Object.defineProperty({}, 'message', {
        configurable: true,
        get: messageGetter,
      }));
      await pending.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(messageGetter).not.toHaveBeenCalled();
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test('ignores an older successful resolution after the page unmounts', async () => {
    const pending = createDeferred();
    adminRegistrationAction.mockReturnValueOnce(pending.promise);
    const view = renderAdminEventRegistrations();
    expect(await screen.findByText(primaryRegistration.runner.email))
      .toBeInTheDocument();
    startRegistrationAction('cancel');
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));
    view.unmount();

    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
      await Promise.resolve();
    });

    expect(getEventBySlug).toHaveBeenCalledTimes(1);
    expect(listRegistrationsForEvent).toHaveBeenCalledTimes(1);
    expect(adminRegistrationAction).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
  });
});

describe('Admin registration CSV export privacy and current-context boundary', () => {
  const CSV_PENDING = 'Registration export in progress. Do not start another registration action or export.';
  const CSV_UNKNOWN = 'We could not confirm that registration export. Do not try again on this page. Stop and contact the event lead, privacy lead, treasurer, and platform owner.';
  const CSV_ENDPOINT = 'https://functions.example.test/exportRegistrationsCsv';
  const CSV_UID = 'synthetic-csv-admin';
  const csvRegistration = {
    id: 'synthetic-csv-registration',
    status: 'paid',
    amountCents: 2500,
    signupType: 'participant',
    priceTier: 'member',
    runner: {
      firstName: 'Synthetic',
      lastName: 'CSV Runner',
      email: 'synthetic-csv-runner@example.test',
      shirtSize: 'M',
    },
  };

  let originalFetch;
  let originalCreateObjectUrlDescriptor;
  let originalRevokeObjectUrlDescriptor;
  let originalElementRemove;
  let pageUser;
  let firebaseUser;
  let resources;
  let services;
  let getHttpFunctionUrl;
  let csvBlob;
  let blobReader;
  let failureStage;
  let exportAnchor;
  let appendedAnchors;
  let clickedDownloads;
  let appendSpy;
  let clickSpy;
  let removeSpy;
  let createObjectUrl;
  let revokeObjectUrl;

  function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, reject, resolve };
  }

  function csvEvent({
    slug = 'synthetic-event',
    title = 'Synthetic CSV Run',
  } = {}) {
    return {
      id: slug,
      slug,
      title,
      startAt: { toDate: () => new Date(2030, 0, 12, 9, 30) },
      location: 'Synthetic CSV Park',
      capacity: 40,
      status: 'open',
      visibility: 'public',
      pricing: { memberCents: 2500, nonMemberCents: 3000 },
    };
  }

  function authResult(user = pageUser) {
    return {
      user,
      isLoading: false,
      isAuthenticated: true,
      isMember: true,
      isAdmin: true,
      signIn: jest.fn(),
      signOut: jest.fn(),
      register: jest.fn(),
    };
  }

  function makeResources({
    app = firebaseApp,
    authUser = firebaseUser,
    db = firestore,
    endpoint = getHttpFunctionUrl,
  } = {}) {
    return {
      app,
      firestore: db,
      auth: { currentUser: authUser },
      getHttpFunctionUrl: endpoint,
    };
  }

  function applyCsvContext({
    currentPageUser = pageUser,
    currentResources = resources,
    currentServices = services,
    ready = true,
  } = {}) {
    pageUser = currentPageUser;
    resources = currentResources;
    services = currentServices;
    useAuth.mockReturnValue(authResult(pageUser));
    useServiceLocator.mockReturnValue({
      services: ready ? services : null,
      isReady: ready,
    });
  }

  function installDownloadHarness() {
    if (appendSpy) return;
    const originalAppend = document.body.appendChild;
    appendSpy = jest.spyOn(document.body, 'appendChild')
      .mockImplementation(function appendChild(node) {
        const result = originalAppend.call(this, node);
        if (node instanceof HTMLAnchorElement) {
          exportAnchor = node;
          appendedAnchors.push(node);
          if (failureStage === 'append') {
            throw new Error('csv-append-private-canary');
          }
        }
        return result;
      });
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function click() {
        clickedDownloads.push({
          download: this.download,
          href: this.href,
        });
        if (failureStage === 'click') {
          throw new Error('csv-click-private-canary');
        }
      });
    removeSpy = jest.spyOn(Element.prototype, 'remove')
      .mockImplementation(function remove() {
        if (this === exportAnchor && failureStage === 'remove') {
          failureStage = null;
          throw new Error('csv-remove-private-canary');
        }
        return originalElementRemove.call(this);
      });
  }

  async function renderLoadedCsv(slug = 'synthetic-event') {
    const view = renderAdminEventRegistrations(slug);
    expect(await screen.findByText(csvRegistration.runner.email)).toBeInTheDocument();
    installDownloadHarness();
    return view;
  }

  async function expectCsvPrivateSurfacesHidden(...privateText) {
    privateText.forEach((text) => expect(document.body).not.toHaveTextContent(text));
    expect(document.body).not.toHaveTextContent(csvRegistration.runner.email);
    expect(document.body).not.toHaveTextContent('Synthetic CSV Run');
    expect(document.body).not.toHaveTextContent('Synthetic CSV Park');
    expect(screen.queryByText('Paid registrations')).not.toBeInTheDocument();
    expect(screen.queryByText('Refunds')).not.toBeInTheDocument();
    expect(screen.queryByText('Gross revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('Refunded amount')).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).not.toContain('Synthetic CSV Run'));
    expect(screen.queryByPlaceholderText('Search by name or email...'))
      .not.toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Export CSV|Exporting/ }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Late registration — $0 only' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ Comp registration' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: /^(Refund|Partial|Sub|Cancel|Note|Create \$0 registration|Create comp)$/,
    })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  }

  function hostileResponse() {
    const okGetter = jest.fn(() => true);
    const blobGetter = jest.fn(() => jest.fn());
    return {
      blobGetter,
      okGetter,
      value: Object.defineProperties({}, {
        ok: {
          configurable: true,
          get: okGetter,
        },
        blob: {
          configurable: true,
          get: blobGetter,
        },
      }),
    };
  }

  beforeEach(() => {
    pageUser = { uid: CSV_UID };
    firebaseUser = {
      uid: CSV_UID,
      getIdToken: jest.fn().mockResolvedValue('synthetic-csv-token'),
    };
    getHttpFunctionUrl = jest.fn().mockReturnValue(CSV_ENDPOINT);
    resources = makeResources();
    services = { firebaseResources: resources };
    applyCsvContext();
    getEventBySlug.mockResolvedValue(csvEvent());
    listRegistrationsForEvent.mockResolvedValue([csvRegistration]);
    adminRegistrationAction.mockReset();
    track.mockReset();

    originalFetch = global.fetch;
    csvBlob = new Blob(['synthetic,csv\nvalue,only'], { type: 'text/csv' });
    blobReader = jest.fn().mockResolvedValue(csvBlob);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: blobReader });

    originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      'createObjectURL',
    );
    originalRevokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      'revokeObjectURL',
    );
    createObjectUrl = jest.fn(() => {
      if (failureStage === 'create-url') {
        throw new Error('csv-create-url-private-canary');
      }
      return `blob:synthetic-csv-${createObjectUrl.mock.calls.length}`;
    });
    revokeObjectUrl = jest.fn(() => {
      if (failureStage === 'revoke') {
        failureStage = null;
        throw new Error('csv-revoke-private-canary');
      }
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
      writable: true,
    });

    originalElementRemove = Element.prototype.remove;
    failureStage = null;
    exportAnchor = null;
    appendedAnchors = [];
    clickedDownloads = [];
    appendSpy = null;
    clickSpy = null;
    removeSpy = null;
  });

  afterEach(() => {
    try {
      appendedAnchors.forEach((anchor) => {
        if (anchor.isConnected) originalElementRemove.call(anchor);
      });
    } finally {
      appendSpy?.mockRestore();
      clickSpy?.mockRestore();
      removeSpy?.mockRestore();
      if (originalCreateObjectUrlDescriptor) {
        Object.defineProperty(
          URL,
          'createObjectURL',
          originalCreateObjectUrlDescriptor,
        );
      } else {
        delete URL.createObjectURL;
      }
      if (originalRevokeObjectUrlDescriptor) {
        Object.defineProperty(
          URL,
          'revokeObjectURL',
          originalRevokeObjectUrlDescriptor,
        );
      } else {
        delete URL.revokeObjectURL;
      }
      if (originalFetch === undefined) delete global.fetch;
      else global.fetch = originalFetch;
      jest.restoreAllMocks();
    }
  });

  test('preserves one exact current download and permits one later deliberate download', async () => {
    await renderLoadedCsv();

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(clickedDownloads).toHaveLength(1));
    expect(firebaseUser.getIdToken).toHaveBeenCalledTimes(1);
    expect(getHttpFunctionUrl).toHaveBeenCalledWith('exportRegistrationsCsv');
    expect(getHttpFunctionUrl).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      `${CSV_ENDPOINT}?eventId=synthetic-event`,
      {
        headers: { Authorization: 'Bearer synthetic-csv-token' },
        signal: expect.any(AbortSignal),
      },
    );
    expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(blobReader).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledWith(csvBlob);
    expect(clickedDownloads[0].href).toBe('blob:synthetic-csv-1');
    expect(clickedDownloads[0].download)
      .toMatch(/^registrations-synthetic-event-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(appendedAnchors[0].isConnected).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:synthetic-csv-1');
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(clickedDownloads).toHaveLength(2));
    expect(firebaseUser.getIdToken).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(blobReader).toHaveBeenCalledTimes(2);
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
    expect(appendedAnchors.every((anchor) => !anchor.isConnected)).toBe(true);
  });

  test('sets a synchronous cross-action lock before token work settles', async () => {
    const tokenRequest = createDeferred();
    firebaseUser.getIdToken.mockReturnValueOnce(tokenRequest.promise);
    const view = await renderLoadedCsv();
    const exportButton = screen.getByRole('button', { name: 'Export CSV' });
    const lateButton = screen.getByRole('button', {
      name: '+ Late registration — $0 only',
    });
    const compButton = screen.getByRole('button', { name: '+ Comp registration' });
    const noteButton = screen.getByRole('button', { name: 'Note' });

    act(() => {
      exportButton.click();
      exportButton.click();
      lateButton.click();
      compButton.click();
      noteButton.click();
    });

    const pending = await screen.findByRole('status');
    expect(pending.textContent).toBe(CSV_PENDING);
    expect(pending).toHaveAttribute('aria-live', 'polite');
    expect(pending).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByRole('button', { name: 'Exporting...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+ Late registration — $0 only' }))
      .toBeDisabled();
    expect(screen.getByRole('button', { name: '+ Comp registration' })).toBeDisabled();
    ['Refund', 'Partial', 'Sub', 'Cancel', 'Note'].forEach((name) => {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    });
    expect(screen.queryByRole('heading', { name: /Add note|Comp registration|Late registration/ }))
      .not.toBeInTheDocument();
    expect(firebaseUser.getIdToken).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(adminRegistrationAction).not.toHaveBeenCalled();

    view.unmount();
    await act(async () => {
      tokenRequest.resolve('synthetic-csv-token');
      await tokenRequest.promise;
      await Promise.resolve();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('closes a same-act modal and prevents its submit while export is pending', async () => {
    const tokenRequest = createDeferred();
    firebaseUser.getIdToken.mockReturnValueOnce(tokenRequest.promise);
    const view = await renderLoadedCsv();
    const exportButton = screen.getByRole('button', { name: 'Export CSV' });
    const noteButton = screen.getByRole('button', { name: 'Note' });

    act(() => {
      noteButton.click();
      exportButton.click();
    });

    expect(await screen.findByRole('status')).toHaveTextContent(CSV_PENDING);
    expect(screen.queryByRole('heading', { name: 'Add note' })).not.toBeInTheDocument();
    expect(adminRegistrationAction).not.toHaveBeenCalled();
    expect(firebaseUser.getIdToken).toHaveBeenCalledTimes(1);

    view.unmount();
    tokenRequest.resolve('synthetic-csv-token');
    await tokenRequest.promise;
  });

  test('keeps export blocked while a late-registration request is pending', async () => {
    const actionRequest = createDeferred();
    adminRegistrationAction.mockReturnValueOnce(actionRequest.promise);
    const view = await renderLoadedCsv();
    const exportButton = screen.getByRole('button', { name: 'Export CSV' });

    fireEvent.click(screen.getByRole('button', {
      name: '+ Late registration — $0 only',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Create $0 registration' }));
    await waitFor(() => expect(adminRegistrationAction).toHaveBeenCalledTimes(1));
    expect(exportButton).toBeDisabled();
    exportButton.click();
    expect(firebaseUser.getIdToken).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    view.unmount();
    actionRequest.resolve({ ok: true });
    await actionRequest.promise;
  });

  test.each([
    'token',
    'endpoint',
    'fetch',
    'http',
    'blob',
    'create-url',
    'append',
    'click',
    'remove',
    'revoke',
  ])('maps a current %s failure to one terminal private result with cleanup', async (
    stage,
  ) => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const storageSpy = jest.spyOn(Storage.prototype, 'setItem');
    const privateCanary = `csv-${stage}-private-canary@example.test`;
    let statusGetter;
    if (stage === 'token') {
      firebaseUser.getIdToken.mockRejectedValueOnce(new Error(privateCanary));
    } else if (stage === 'endpoint') {
      getHttpFunctionUrl.mockImplementationOnce(() => {
        throw new Error(privateCanary);
      });
    } else if (stage === 'fetch') {
      global.fetch.mockRejectedValueOnce(new Error(privateCanary));
    } else if (stage === 'http') {
      statusGetter = jest.fn(() => privateCanary);
      global.fetch.mockResolvedValueOnce(Object.defineProperties({}, {
        ok: { configurable: true, value: false },
        status: { configurable: true, get: statusGetter },
      }));
    } else if (stage === 'blob') {
      blobReader.mockRejectedValueOnce(new Error(privateCanary));
    } else {
      failureStage = stage;
    }

    const view = await renderLoadedCsv();
    const exportButton = screen.getByRole('button', { name: 'Export CSV' });
    fireEvent.click(exportButton);

    const alert = await screen.findByRole('alert');
    const [, fetchOptions] = global.fetch.mock.calls[0] || [];
    expect(alert.textContent).toBe(CSV_UNKNOWN);
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveAttribute('aria-atomic', 'true');
    await expectCsvPrivateSurfacesHidden(privateCanary);
    if (statusGetter) {
      expect(statusGetter).not.toHaveBeenCalled();
    }
    expect(track).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    if (fetchOptions) {
      expect(fetchOptions.signal.aborted).toBe(true);
    }
    expect(firebaseUser.getIdToken).toHaveBeenCalledTimes(1);
    expect(getHttpFunctionUrl).toHaveBeenCalledTimes(stage === 'token' ? 0 : 1);
    expect(global.fetch).toHaveBeenCalledTimes(
      ['token', 'endpoint'].includes(stage) ? 0 : 1,
    );
    expect(blobReader).toHaveBeenCalledTimes(
      ['blob', 'create-url', 'append', 'click', 'remove', 'revoke'].includes(stage)
        ? 1
        : 0,
    );
    expect(createObjectUrl).toHaveBeenCalledTimes(
      ['create-url', 'append', 'click', 'remove', 'revoke'].includes(stage) ? 1 : 0,
    );
    expect(clickSpy).toHaveBeenCalledTimes(
      ['click', 'remove', 'revoke'].includes(stage) ? 1 : 0,
    );
    expect(clickedDownloads).toHaveLength(
      ['click', 'remove', 'revoke'].includes(stage) ? 1 : 0,
    );
    appendedAnchors.forEach((anchor) => expect(anchor.isConnected).toBe(false));
    if (['create-url', 'append', 'click', 'remove', 'revoke'].includes(stage)) {
      if (stage !== 'create-url') {
        expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
      }
      expect(document.querySelector('a[download]')).not.toBeInTheDocument();
    }

    view.rerender(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent(CSV_UNKNOWN);
    await expectCsvPrivateSurfacesHidden(privateCanary);
  });

  test.each([
    ['undefined', () => ({ traps: [], value: undefined })],
    ['null', () => ({ traps: [], value: null })],
    ['primitive', () => ({
      traps: [],
      value: 'csv-primitive-private-canary@example.test',
    })],
    ['accessor and coercion', () => {
      const message = jest.fn(() => 'csv-accessor-private-canary');
      const toString = jest.fn(() => 'csv-string-private-canary');
      const valueOf = jest.fn(() => 41);
      const toPrimitive = jest.fn(() => 'csv-primitive-hook-canary');
      return {
        traps: [message, toString, valueOf, toPrimitive],
        value: Object.defineProperties({}, {
          message: { configurable: true, get: message },
          toString: { configurable: true, value: toString },
          valueOf: { configurable: true, value: valueOf },
          [Symbol.toPrimitive]: { configurable: true, value: toPrimitive },
        }),
      };
    }],
    ['Proxy', () => {
      const traps = {
        get: jest.fn(() => { throw new Error('csv-get-trap-canary'); }),
        getOwnPropertyDescriptor: jest.fn(() => {
          throw new Error('csv-descriptor-trap-canary');
        }),
        getPrototypeOf: jest.fn(() => {
          throw new Error('csv-prototype-trap-canary');
        }),
        has: jest.fn(() => { throw new Error('csv-has-trap-canary'); }),
        ownKeys: jest.fn(() => { throw new Error('csv-keys-trap-canary'); }),
      };
      return {
        traps: Object.values(traps),
        value: new Proxy({}, traps),
      };
    }],
  ])('does not inspect a hostile %s rejection', async (_label, makeRejection) => {
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    const { traps, value } = makeRejection();
    global.fetch.mockRejectedValueOnce(value);
    await renderLoadedCsv();

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect((await screen.findByRole('alert')).textContent).toBe(CSV_UNKNOWN);
    traps.forEach((trap) => expect(trap).not.toHaveBeenCalled());
    expect(document.body).not.toHaveTextContent(
      /csv-(accessor|descriptor|get|has|keys|primitive|prototype|string)-.*canary/i,
    );
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  test.each([
    ['empty page UID', { authUid: CSV_UID, pageUid: '' }],
    ['empty Firebase UID', { authUid: '', pageUid: CSV_UID }],
    ['mismatched UIDs', { authUid: 'synthetic-other-admin', pageUid: CSV_UID }],
    ['missing Firebase user', { authUid: null, pageUid: CSV_UID }],
  ])('starts no export for %s', async (_label, { authUid, pageUid }) => {
    pageUser = { uid: pageUid };
    firebaseUser = authUid === null
      ? null
      : { uid: authUid, getIdToken: jest.fn() };
    resources = makeResources({ authUser: firebaseUser });
    services = { firebaseResources: resources };
    applyCsvContext();
    await renderLoadedCsv();

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await act(async () => Promise.resolve());

    if (firebaseUser) {
      expect(firebaseUser.getIdToken).not.toHaveBeenCalled();
    }
    expect(getHttpFunctionUrl).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(clickedDownloads).toHaveLength(0);
  });

  test.each([
    'services',
    'resources',
    'app',
    'firestore',
    'route',
    'readiness',
    'page-user',
    'firebase-user',
  ])('aborts and ignores an older response after %s changes', async (change) => {
    const request = createDeferred();
    global.fetch.mockReturnValueOnce(request.promise);
    const view = await renderLoadedCsv();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [, { signal }] = global.fetch.mock.calls[0];

    if (change === 'services') {
      services = { firebaseResources: resources };
      applyCsvContext({ currentServices: services });
      view.rerender(<App />);
    } else if (change === 'resources') {
      resources = makeResources();
      services = { firebaseResources: resources };
      applyCsvContext({ currentResources: resources, currentServices: services });
      view.rerender(<App />);
    } else if (change === 'app') {
      resources = makeResources({ app: { name: 'synthetic-current-csv-app' } });
      services = { firebaseResources: resources };
      applyCsvContext({ currentResources: resources, currentServices: services });
      view.rerender(<App />);
    } else if (change === 'firestore') {
      resources = makeResources({ db: { name: 'synthetic-current-csv-firestore' } });
      services = { firebaseResources: resources };
      applyCsvContext({ currentResources: resources, currentServices: services });
      view.rerender(<App />);
    } else if (change === 'route') {
      window.history.pushState(
        {},
        '',
        '/admin/events/synthetic-current-csv-event/registrations',
      );
      fireEvent(window, new PopStateEvent('popstate'));
    } else if (change === 'readiness') {
      applyCsvContext({ ready: false });
      view.rerender(<App />);
    } else if (change === 'page-user') {
      pageUser = { uid: CSV_UID };
      applyCsvContext({ currentPageUser: pageUser });
      view.rerender(<App />);
    } else {
      firebaseUser = {
        uid: CSV_UID,
        getIdToken: jest.fn().mockResolvedValue('synthetic-current-token'),
      };
      resources.auth.currentUser = firebaseUser;
      applyCsvContext();
      view.rerender(<App />);
    }

    expect(signal.aborted).toBe(true);
    const oldResponse = hostileResponse();
    await act(async () => {
      request.resolve(oldResponse.value);
      await request.promise;
      await Promise.resolve();
    });

    expect(oldResponse.okGetter).not.toHaveBeenCalled();
    expect(oldResponse.blobGetter).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(clickedDownloads).toHaveLength(0);
    expect(screen.queryByText(CSV_UNKNOWN)).not.toBeInTheDocument();
  });

  test.each(['token', 'blob'])(
    'checks the exact context again after the %s await boundary',
    async (boundary) => {
      const request = createDeferred();
      if (boundary === 'token') {
        firebaseUser.getIdToken.mockReturnValueOnce(request.promise);
      } else {
        blobReader.mockReturnValueOnce(request.promise);
      }
      const view = await renderLoadedCsv();
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
      if (boundary === 'blob') {
        await waitFor(() => expect(blobReader).toHaveBeenCalledTimes(1));
      }

      pageUser = { uid: CSV_UID };
      applyCsvContext({ currentPageUser: pageUser });
      view.rerender(<App />);
      await act(async () => {
        request.resolve(boundary === 'token' ? 'synthetic-old-token' : csvBlob);
        await request.promise;
        await Promise.resolve();
      });

      if (boundary === 'token') expect(global.fetch).not.toHaveBeenCalled();
      expect(createObjectUrl).not.toHaveBeenCalled();
      expect(clickedDownloads).toHaveLength(0);
    },
  );

  test('keeps an A to B to A response inert after a newer A download', async () => {
    const oldRequest = createDeferred();
    const oldResponse = hostileResponse();
    global.fetch
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce({ ok: true, blob: blobReader });
    await renderLoadedCsv();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [, { signal: oldSignal }] = global.fetch.mock.calls[0];

    window.history.pushState(
      {},
      '',
      '/admin/events/synthetic-csv-event-b/registrations',
    );
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByText(csvRegistration.runner.email)).toBeInTheDocument();
    window.history.pushState(
      {},
      '',
      '/admin/events/synthetic-event/registrations',
    );
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByText(csvRegistration.runner.email)).toBeInTheDocument();
    expect(oldSignal.aborted).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(clickedDownloads).toHaveLength(1));

    await act(async () => {
      oldRequest.resolve(oldResponse.value);
      await oldRequest.promise;
      await Promise.resolve();
    });
    expect(oldResponse.okGetter).not.toHaveBeenCalled();
    expect(oldResponse.blobGetter).not.toHaveBeenCalled();
    expect(clickedDownloads).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('aborts and ignores a hostile response after unmount', async () => {
    const request = createDeferred();
    const oldResponse = hostileResponse();
    const consoleSpies = ['debug', 'error', 'info', 'log', 'warn']
      .map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
    global.fetch.mockReturnValueOnce(request.promise);
    const view = await renderLoadedCsv();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [, { signal }] = global.fetch.mock.calls[0];
    view.unmount();
    expect(signal.aborted).toBe(true);

    await act(async () => {
      request.resolve(oldResponse.value);
      await request.promise;
      await Promise.resolve();
    });

    expect(oldResponse.okGetter).not.toHaveBeenCalled();
    expect(oldResponse.blobGetter).not.toHaveBeenCalled();
    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(clickedDownloads).toHaveLength(0);
    expect(track).not.toHaveBeenCalled();
    consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});
