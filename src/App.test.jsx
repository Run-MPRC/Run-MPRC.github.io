import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./services/ServiceLocatorProvider', () => function TestServiceLocatorProvider({
  children,
}) {
  return children;
});

jest.mock('./services/ServiceLocatorContext', () => ({
  useServiceLocator: () => ({ services: null, isReady: false }),
}));

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

test('renders the MPRC home route without contacting Firebase', () => {
  render(<App />);
  expect(screen.getByRole('heading', {
    level: 1,
    name: /mid-peninsula running club/i,
  })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /skip to content/i })).toHaveAttribute(
    'href',
    '#main-content',
  );
});

test('folds the public club introduction into Events', () => {
  window.history.pushState({}, '', '/events');
  render(<App />);

  expect(screen.getByRole('heading', {
    level: 1,
    name: /run and connect with mprc/i,
  })).toBeInTheDocument();
  expect(screen.getByRole('heading', {
    name: /current and upcoming events/i,
  })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /^activities$/i })).not.toBeInTheDocument();
});

test('shows the requested social destinations on Contact', () => {
  window.history.pushState({}, '', '/contact');
  render(<App />);

  expect(screen.getByRole('link', { name: /mprc on strava/i })).toHaveAttribute(
    'href',
    'https://www.strava.com/clubs/793882',
  );
  expect(screen.getByRole('link', { name: /mprc on instagram/i })).toHaveAttribute(
    'href',
    'https://www.instagram.com/runmprc/',
  );
});

test('links to member discounts from Shop', () => {
  window.history.pushState({}, '', '/shop');
  render(<App />);

  expect(screen.getByRole('link', { name: /view discounts/i })).toHaveAttribute(
    'href',
    'https://sites.google.com/view/mprcdiscounts',
  );
});
