/* eslint-env jest */
import React from 'react';
import { render, screen } from '@testing-library/react';
import JoinUs from './JoinUs';

jest.mock('../../components/SEO', () => () => null);
jest.mock('./Route', () => () => null);

test('replaces Google membership signup with Zeffy while preserving the separate activity waiver', () => {
  render(<JoinUs />);
  expect(screen.getByRole('region', { name: 'MPRC membership signup' })).toBeVisible();
  expect(screen.getByRole('link', { name: /open the membership form/i }))
    .toHaveAttribute('href', 'https://www.zeffy.com/en-US/ticketing/mid-peninsula-running-clubs-membership');
  expect(screen.queryByRole('link', { name: 'Membership Application Form' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Sign Waiver Form' })).toBeVisible();
  expect(screen.queryByText(/Affordable membership fees/)).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Become an MPRC Member' })).toBeVisible();
});
