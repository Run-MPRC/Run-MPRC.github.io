/* eslint-env jest */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import Header from './components/Header';
import Navbar from './components/Navbar';
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

const normalizeSelector = (selector) => selector
  .replace(/\s+/g, ' ')
  .replace(/\s*,\s*/g, ',')
  .trim();

const getStylesheetRules = (stylesheet) => [...stylesheet
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/@tailwind[^;]*;/g, '')
  .matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, declarations]) => ({
    selector: normalizeSelector(selector),
    declarations,
  }));

const getDeclarations = (rule) => rule
  .split(';')
  .map((declaration) => declaration.trim())
  .filter(Boolean)
  .flatMap((declaration) => {
    const colon = declaration.indexOf(':');
    if (colon < 0) return [];
    return [{
      property: declaration.slice(0, colon).trim(),
      value: declaration.slice(colon + 1).trim(),
    }];
  });

const getDeclarationValues = (rule, property) => getDeclarations(rule)
  .filter((declaration) => declaration.property === property)
  .map((declaration) => declaration.value);

const getShorthandTokens = (value) => (
  value.match(/(?:[^\s()]|\([^)]*\))+/g) ?? []
);

const suppressesOutline = ({ property, value }) => {
  const normalizedValue = value.replace(/\s*!important\s*$/i, '').trim();

  if (property === 'outline') {
    return getShorthandTokens(normalizedValue).some((token) => (
      /^(?:0(?:\.0+)?(?:[a-z%]+)?|none|transparent)$/i.test(token)
    ));
  }
  if (property === 'outline-width') {
    return /^0(?:\.0+)?(?:[a-z%]+)?$/i.test(normalizedValue);
  }
  if (property === 'outline-style') {
    return /^none$/i.test(normalizedValue);
  }
  if (property === 'outline-color') {
    return /^transparent$/i.test(normalizedValue);
  }
  return false;
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
      'Club merchandise for in-person pickup at a club run.',
    )).toBeInTheDocument();
    expect(screen.getByRole('heading', {
      level: 2,
      name: 'In-person club merchandise',
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

describe('mobile navigation disclosure semantics', () => {
  const renderNavbar = () => render(React.createElement(
    MemoryRouter,
    {
      initialEntries: ['/synthetic-start'],
      future: { v7_startTransition: true, v7_relativeSplatPath: true },
    },
    React.createElement(Navbar),
  ));

  const expectMenuState = (toggle, list, isOpen) => {
    expect(list).toHaveClass(isOpen ? 'show__nav' : 'hide__nav');
    expect(list).not.toHaveClass(isOpen ? 'hide__nav' : 'show__nav');
    expect(toggle).toHaveAttribute('aria-expanded', String(isOpen));
    expect(toggle).toHaveAccessibleName(
      isOpen ? 'Close navigation menu' : 'Open navigation menu',
    );
  };

  test('binds the toggle disclosure state to one stable navigation list', () => {
    renderNavbar();

    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    const list = screen.getByRole('list');
    expect(list.id).toBe('primary-navigation');
    expect(document.querySelectorAll(`#${list.id}`)).toHaveLength(1);
    expect(toggle).toHaveAttribute('aria-controls', list.id);
    expectMenuState(toggle, list, false);

    fireEvent.click(toggle);
    expectMenuState(toggle, list, true);

    fireEvent.click(toggle);
    expectMenuState(toggle, list, false);
  });

  test.each([
    ['MPRC logo', () => screen.getByRole('link', { name: 'MPRC Logo' })],
    ['ordinary destination', () => screen.getByRole('link', { name: 'Join Us' })],
    ['authentication destination', () => screen.getByRole('link', { name: 'Sign in' })],
  ])('selecting the %s always leaves the menu closed', (_label, getTarget) => {
    renderNavbar();

    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    const list = screen.getByRole('list');

    fireEvent.click(getTarget());
    expectMenuState(toggle, list, false);

    fireEvent.click(toggle);
    expectMenuState(toggle, list, true);
    fireEvent.click(getTarget());
    expectMenuState(toggle, list, false);
  });
});

describe('global keyboard focus visibility', () => {
  const globalStyles = readStylesheet('index.css');
  const stylesheetRules = getStylesheetRules(globalStyles);
  const approvedFocusSelector = [
    ':focus-visible',
    '.hover\\:shadow-md:hover:focus-visible',
  ].join(',');

  test('does not suppress outlines in the universal reset', () => {
    const resetRules = stylesheetRules.filter(
      ({ selector }) => selector === '*,*::before,*::after',
    );

    expect(resetRules).toHaveLength(1);
    const resetProperties = getDeclarations(resetRules[0].declarations)
      .map((declaration) => declaration.property);
    expect(resetProperties).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^outline(?:-|$)/i)]),
    );
  });

  test('provides a bounded two-tone focus-visible indicator', () => {
    const globalFocusRules = stylesheetRules.filter(
      ({ selector }) => selector === approvedFocusSelector,
    );
    expect(globalFocusRules).toHaveLength(1);
    expect(globalFocusRules[0].selector).toBe(approvedFocusSelector);

    const focusVisibleRule = globalFocusRules[0].declarations;
    const outlines = getDeclarationValues(focusVisibleRule, 'outline');
    const outlineOffsets = getDeclarationValues(focusVisibleRule, 'outline-offset');
    const shadows = getDeclarationValues(focusVisibleRule, 'box-shadow');
    expect(outlines).toHaveLength(1);
    expect(outlineOffsets).toHaveLength(1);
    expect(shadows).toHaveLength(1);

    const outline = outlines[0].match(
      /^(\d+(?:\.\d+)?)px\s+solid\s+var\(--color-secondary\)$/,
    );
    const outlineOffset = outlineOffsets[0].match(
      /^(\d+(?:\.\d+)?)px$/,
    );
    const shadow = shadows[0].match(
      /^0\s+0\s+0\s+(\d+(?:\.\d+)?)px\s+var\(--color-gray-600\)$/,
    );

    expect(outline).not.toBeNull();
    expect(Number(outline?.[1])).toBeGreaterThan(0);
    expect(Number(outline?.[1])).toBeLessThanOrEqual(4);
    expect(outlineOffset).not.toBeNull();
    expect(Number(outlineOffset?.[1])).toBeGreaterThan(0);
    expect(Number(outlineOffset?.[1])).toBeLessThanOrEqual(4);
    expect(shadow).not.toBeNull();
    expect(Number(shadow?.[1])).toBeGreaterThan(0);
    expect(Number(shadow?.[1])).toBeLessThanOrEqual(8);
  });

  test('keeps the focused main cue inside the viewport below fixed navigation', () => {
    const mainFocusRules = stylesheetRules.filter(
      ({ selector }) => selector === '#main-content:focus-visible::after',
    );
    expect(mainFocusRules).toHaveLength(1);

    const [{ declarations }] = mainFocusRules;
    expect(getDeclarationValues(declarations, 'content')).toEqual(['""']);
    expect(getDeclarationValues(declarations, 'position')).toEqual(['fixed']);
    const [cueZIndex] = getDeclarationValues(declarations, 'z-index');
    expect(cueZIndex).toBe('98');
    const [navigationZIndex] = getDeclarationValues(
      getRule(readStylesheet('components', 'navbar.css'), 'nav'),
      'z-index',
    );
    expect(navigationZIndex).toBe('99');
    expect(Number(cueZIndex)).toBeLessThan(Number(navigationZIndex));
    expect(getDeclarationValues(declarations, 'pointer-events')).toEqual(['none']);
    expect(getDeclarationValues(declarations, 'box-sizing')).toEqual(['border-box']);
    expect(getDeclarationValues(declarations, 'border')).toEqual([
      '3px solid var(--color-secondary)',
    ]);
    expect(getDeclarationValues(declarations, 'box-shadow')).toEqual([
      '0 0 0 3px var(--color-gray-600)',
    ]);

    const focusRule = stylesheetRules.find(
      ({ selector }) => selector === approvedFocusSelector,
    );
    const outlineWidth = getDeclarationValues(focusRule.declarations, 'outline')[0]
      .match(/^(\d+(?:\.\d+)?)px\s/)?.[1];
    const outlineOffset = getDeclarationValues(
      focusRule.declarations,
      'outline-offset',
    )[0].match(/^(\d+(?:\.\d+)?)px$/)?.[1];
    const shadowSpread = getDeclarationValues(focusRule.declarations, 'box-shadow')[0]
      .match(/^0\s+0\s+0\s+(\d+(?:\.\d+)?)px\s/)?.[1];
    const decorationExtent = Math.max(
      Number(outlineWidth) + Number(outlineOffset),
      Number(shadowSpread),
    );

    ['right', 'bottom', 'left'].forEach((property) => {
      const inset = getDeclarationValues(declarations, property)[0]
        .match(/^(\d+(?:\.\d+)?)px$/)?.[1];
      expect(Number(inset)).toBeGreaterThanOrEqual(decorationExtent);
    });
    const top = getDeclarationValues(declarations, 'top');
    expect(top).toEqual([
      `calc(var(--site-nav-height) + ${decorationExtent}px)`,
    ]);
  });

  test('has no competing outline suppression in the global stylesheet', () => {
    const suppressingRules = stylesheetRules
      .filter(({ declarations }) => getDeclarations(declarations).some(suppressesOutline))
      .map(({ selector }) => selector);

    expect(suppressingRules).toEqual([]);
  });

  test('keeps the focused skip-link indicator inside the viewport', () => {
    const focusRule = stylesheetRules.find(
      ({ selector }) => selector === approvedFocusSelector,
    );
    const skipFocusRules = stylesheetRules.filter(
      ({ selector }) => selector === '.skip-to-content:focus',
    );
    expect(focusRule).toBeDefined();
    expect(skipFocusRules).toHaveLength(1);

    const outlineWidth = getDeclarationValues(focusRule.declarations, 'outline')[0]
      .match(/^(\d+(?:\.\d+)?)px\s/)?.[1];
    const outlineOffset = getDeclarationValues(
      focusRule.declarations,
      'outline-offset',
    )[0].match(/^(\d+(?:\.\d+)?)px$/)?.[1];
    const shadowSpread = getDeclarationValues(focusRule.declarations, 'box-shadow')[0]
      .match(/^0\s+0\s+0\s+(\d+(?:\.\d+)?)px\s/)?.[1];
    const decorationExtent = Math.max(
      Number(outlineWidth) + Number(outlineOffset),
      Number(shadowSpread),
    );

    ['left', 'top'].forEach((property) => {
      const values = getDeclarationValues(skipFocusRules[0].declarations, property);
      expect(values).toHaveLength(1);
      const inset = values[0].match(/^(\d+(?:\.\d+)?)px$/)?.[1];
      expect(Number(inset)).toBeGreaterThanOrEqual(decorationExtent);
    });
  });
});
