/* eslint-env jest */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { useServiceLocator } from './services/ServiceLocatorContext';
import {
  listMemberEvents,
  listPublicEvents,
} from './services/events/eventsService';
import { useAuth } from './services/hooks/useAuth';
import Events from './pages/events/Events';
import EventCalendar from './pages/events/EventCalendar';
import Shop from './pages/shop/Shop';

const EVENTS_FAILURE = 'We could not load events right now. Please try again later.';
const firestore = Object.freeze({ testOnly: true });

jest.mock('./services/ServiceLocatorContext', () => ({
  useServiceLocator: jest.fn(),
}));

jest.mock('./services/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('./services/events/eventsService', () => ({
  formatEventDate: jest.fn(() => 'January 12, 2030'),
  formatPrice: jest.fn((cents) => `$${(cents / 100).toFixed(2)}`),
  listMemberEvents: jest.fn(),
  listPublicEvents: jest.fn(),
}));

function renderRoute(component) {
  return render(
    <HelmetProvider>
      <MemoryRouter>{component}</MemoryRouter>
    </HelmetProvider>,
  );
}

beforeEach(() => {
  useServiceLocator.mockReset();
  useServiceLocator.mockReturnValue({
    services: { firebaseResources: { firestore } },
    isReady: true,
  });
  useAuth.mockReset();
  useAuth.mockReturnValue({ isMember: false });
  listMemberEvents.mockReset();
  listPublicEvents.mockReset();
});

test.each([
  ['Events list', <Events />, `Error: ${EVENTS_FAILURE}`],
  ['Events calendar', <EventCalendar />, EVENTS_FAILURE],
])('%s replaces rejected provider details with one accessible message', (
  _surface,
  component,
  expectedMessage,
) => {
  const unsubscribe = jest.fn();
  const messageGetter = jest.fn(() => {
    throw new Error('private-provider-message-getter');
  });
  const rejection = Object.defineProperty({}, 'message', {
    configurable: true,
    get: messageGetter,
  });
  listPublicEvents.mockImplementation((_db, _onChange, onError) => {
    onError(rejection);
    return unsubscribe;
  });

  const view = renderRoute(component);
  const alert = screen.getByRole('alert');

  expect(alert).toHaveTextContent(expectedMessage);
  expect(alert).toHaveAttribute('aria-live', 'assertive');
  expect(alert).toHaveAttribute('aria-atomic', 'true');
  expect(messageGetter).not.toHaveBeenCalled();
  expect(document.body).not.toHaveTextContent('private-provider-message-getter');
  expect(listPublicEvents).toHaveBeenCalledWith(
    firestore,
    expect.any(Function),
    expect.any(Function),
  );
  expect(listMemberEvents).not.toHaveBeenCalled();

  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('Shop shows only the approved in-person catalog without a data request', () => {
  useServiceLocator.mockClear();

  renderRoute(<Shop />);

  const catalog = screen.getByRole('region', {
    name: 'In-person club merchandise',
  });
  const cards = within(catalog).getAllByRole('article');
  const hat = within(catalog).getByRole('article', { name: 'MPRC Hat' });
  const jacket = within(catalog).getByRole('article', { name: 'MPRC Jacket' });

  expect(cards).toHaveLength(2);
  expect(within(hat).getByText('$10.00')).toBeInTheDocument();
  expect(within(jacket).getByText('$25.00')).toBeInTheDocument();
  cards.forEach((card) => {
    expect(within(card).getByText(
      'Check availability with the Treasurer at a club run. Pickup is in person. If payment is still due, pay the Treasurer by cash or Venmo.',
    )).toBeInTheDocument();
  });
  expect(catalog.querySelector('a, button, form, input, select, textarea')).toBeNull();
  expect(useServiceLocator).not.toHaveBeenCalled();
  expect(listPublicEvents).not.toHaveBeenCalled();
  expect(listMemberEvents).not.toHaveBeenCalled();
});
