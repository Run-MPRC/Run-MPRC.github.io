/* eslint-env jest */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import Header from './components/Header';
import Events from './pages/events/Events';
import Shop from './pages/shop/Shop';
import Account from './pages/account/Account';
import { useServiceLocator } from './services/ServiceLocatorContext';
import { useAuth } from './services/hooks/useAuth';

jest.mock('./services/ServiceLocatorContext', () => ({
  useServiceLocator: jest.fn(),
}));

jest.mock('./services/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('./pages/account/StravaSection', () => function StravaSection() {
  return <div data-testid="strava-section" />;
});

const readStylesheet = (...parts) => readFileSync(join(__dirname, ...parts), 'utf8');

const getRule = (stylesheet, selector) => {
  const stylesheetWithoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesheetWithoutComments.match(
    new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`),
  );

  return match?.[1] ?? '';
};

const defaultAuthState = {
  user: null,
  isLoading: false,
  isAuthenticated: false,
  isMember: false,
  isAdmin: false,
};

const renderPage = (page) => render(
  <HelmetProvider>
    <MemoryRouter
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true,
      }}
    >
      {page}
    </MemoryRouter>
  </HelmetProvider>,
);

const expectDecorativeHero = (container, title) => {
  expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  const image = container.querySelector('.header img');
  expect(image).toHaveAttribute('alt', '');
  expect(image).toHaveAttribute('aria-hidden', 'true');
};

beforeEach(() => {
  useServiceLocator.mockReturnValue({ services: null, isReady: false });
  useAuth.mockReturnValue(defaultAuthState);
});

describe('persistent navigation clearance', () => {
  const globalStyles = readStylesheet('index.css');
  const navbarStyles = readStylesheet('components', 'navbar.css');
  const homeStyles = readStylesheet('pages', 'home', 'home.css');

  test('uses one shared height for the fixed navigation and main content offset', () => {
    expect(getRule(globalStyles, ':root')).toMatch(
      /--site-nav-height:\s*5\.5rem\s*;/,
    );

    const navigationRule = getRule(navbarStyles, 'nav');
    expect(navigationRule).toMatch(/height:\s*var\(--site-nav-height\)\s*;/);
    expect(navigationRule).toMatch(/position:\s*fixed\s*;/);
    expect(navigationRule).toMatch(/top:\s*0\s*;/);

    const mainRule = getRule(globalStyles, '#main-content');
    expect(mainRule).toMatch(
      /padding-top:\s*var\(--site-nav-height\)\s*;/,
    );
  });

  test('does not add legacy hero offsets on top of the shared clearance', () => {
    expect(getRule(globalStyles, '.header')).toMatch(/margin-top:\s*0\s*;/);
    expect(getRule(homeStyles, '.main__header')).toMatch(/margin-top:\s*0\s*;/);
  });
});

describe('shared page hero semantics', () => {
  test('uses one page heading and omits an empty description', () => {
    const { container } = render(<Header title="Example page" image="/hero.jpg" />);

    expectDecorativeHero(container, 'Example page');
    expect(container.querySelector('.header__content p')).not.toBeInTheDocument();
  });

  test('renders Events with a semantic hero before its section heading', () => {
    const { container } = renderPage(<Events />);

    expectDecorativeHero(container, 'Events');
    expect(screen.getByText(
      'Runs, races, and social gatherings with the MPRC community.',
    )).toBeInTheDocument();
    expect(screen.getByRole('heading', {
      level: 2,
      name: 'Upcoming Events',
    })).toBeInTheDocument();
  });

  test('renders Shop with a semantic hero before its section heading', () => {
    const { container } = renderPage(<Shop />);

    expectDecorativeHero(container, 'MPRC Shop');
    expect(screen.getByText(
      'Club merchandise and gear for the MPRC community.',
    )).toBeInTheDocument();
    expect(screen.getByRole('heading', {
      level: 2,
      name: 'Available merchandise',
    })).toBeInTheDocument();
  });

  test('keeps the My Account hero mounted across authentication and profile loading', () => {
    useAuth.mockReturnValue({
      ...defaultAuthState,
      isLoading: true,
    });
    const view = renderPage(<Account />);
    const originalHeader = view.container.querySelector('.header');

    expectDecorativeHero(view.container, 'My Account');
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');

    useAuth.mockReturnValue({
      ...defaultAuthState,
      user: {
        uid: 'synthetic-user',
        email: 'member@example.test',
        role: 'unverified',
      },
      isAuthenticated: true,
    });
    view.rerender(
      <HelmetProvider>
        <MemoryRouter
          future={{
            v7_relativeSplatPath: true,
            v7_startTransition: true,
          }}
        >
          <Account />
        </MemoryRouter>
      </HelmetProvider>,
    );

    expect(view.container.querySelector('.header')).toBe(originalHeader);
    expect(screen.getByText('Loading profile...')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
