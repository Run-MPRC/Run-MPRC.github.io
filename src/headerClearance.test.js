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
    const globalFocusRules = stylesheetRules.filter(({ selector }) => (
      selector.includes(':focus-visible')
    ));
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
