/* eslint-env jest */

import { readFileSync } from 'fs';
import { join } from 'path';

const readStylesheet = (...parts) => readFileSync(join(__dirname, ...parts), 'utf8');

const getRule = (stylesheet, selector) => {
  const stylesheetWithoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesheetWithoutComments.match(
    new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`),
  );

  return match?.[1] ?? '';
};

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
