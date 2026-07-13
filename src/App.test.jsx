/* eslint-env jest */

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
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
});
