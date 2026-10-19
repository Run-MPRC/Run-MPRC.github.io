/* eslint-env jest */
import React from 'react';
import { render, screen } from '@testing-library/react';
import JoinUs from './JoinUs';
import { WAIVER_FORM_LINK } from '../../text/externalLinks';

jest.mock('../../components/SEO', () => () => null);
jest.mock('./Route', () => () => null);

test('uses Zeffy for membership and retains the existing waiver form for guests only', () => {
  render(<JoinUs />);
  expect(screen.getByRole('region', { name: 'MPRC membership signup' })).toBeVisible();
  expect(screen.getByRole('link', { name: /open the membership form/i }))
    .toHaveAttribute('href', 'https://www.zeffy.com/en-US/ticketing/mid-peninsula-running-clubs-membership');
  expect(screen.queryByRole('link', { name: 'Membership Application Form' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Complete guest waiver' }))
    .toHaveAttribute('href', WAIVER_FORM_LINK.replace('?embedded=true', ''));
  expect(screen.getByRole('link', { name: 'Use the guest waiver' }))
    .toHaveAttribute('href', '#guest-waiver');
  expect(screen.getByRole('heading', { name: 'Guest waiver' })).toHaveAttribute('id', 'guest-waiver');
  expect(screen.queryByRole('heading', { name: 'Club Activity Waiver' })).not.toBeInTheDocument();
  expect(screen.queryByText(/I agree that as a member, or guest/)).not.toBeInTheDocument();
  expect(screen.getByText(/No MPRC account is needed/)).toBeVisible();
  expect(screen.queryByText(/Affordable membership fees/)).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Become an MPRC Member' })).toBeVisible();
});
