/* eslint-env jest */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import JoinUsConditionalRoute from './JoinUsConditionalRoute';
import RunWithUs from './RunWithUs';
import { links } from '../../data';

jest.mock('./Route', () => function TestRoute() {
  return <div data-testid="route-map" />;
});

const ZEFFY_MEMBERSHIP_URL = 'https://www.zeffy.com/en-US/ticketing/mid-peninsula-running-clubs-new-member-registration';

function renderPage(page) {
  return render(
    <HelmetProvider>
      <MemoryRouter>{page}</MemoryRouter>
    </HelmetProvider>,
  );
}

test('Join Us is the membership page and links only to the Zeffy membership form', () => {
  renderPage(<JoinUsConditionalRoute />);

  expect(screen.getByRole('heading', { name: 'Become an MPRC Member' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Membership Application Form' }))
    .toHaveAttribute('href', ZEFFY_MEMBERSHIP_URL);
  expect(screen.getByRole('link', { name: 'Membership Form' }))
    .toHaveAttribute('href', ZEFFY_MEMBERSHIP_URL);

  expect(screen.queryByRole('heading', { name: 'Club Activity Waiver' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Sign Waiver Form' })).not.toBeInTheDocument();
  expect(document.querySelector('a[href*="docs.google.com/forms"]')).toBeNull();
  expect(screen.getByRole('link', { name: 'Run With Us' })).toHaveAttribute('href', '/run-with-us');
});

test('Run With Us carries the waiver and meeting details, not the membership form', () => {
  renderPage(<RunWithUs />);

  expect(screen.getByRole('heading', { name: 'Club Activity Waiver' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Sign Waiver Form' }))
    .toHaveAttribute('href', expect.stringContaining('docs.google.com/forms'));
  expect(screen.getByRole('heading', { name: 'Ways To Run With Us' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Get Directions To Our Meeting Location' })).toBeInTheDocument();

  expect(screen.queryByRole('heading', { name: 'Become an MPRC Member' })).not.toBeInTheDocument();
  expect(document.querySelector(`a[href="${ZEFFY_MEMBERSHIP_URL}"]`)).toBeNull();
  expect(screen.getByRole('link', { name: 'Join Us' })).toHaveAttribute('href', '/joinus');
});

test('navigation lists Join Us and Run With Us as separate pages', () => {
  expect(links).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Join Us', path: '/joinus' }),
    expect.objectContaining({ name: 'Run With Us', path: '/run-with-us' }),
  ]));
});
