/* eslint-env jest */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { resolvePath } from 'react-router-dom';
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
