/* eslint-env jest */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  fireEvent, render, screen, within,
} from '@testing-library/react';
import Navbar from './Navbar';
import Footer from './Footer';

test('keeps account entry out of the public menu and provides separate officer access in the footer', () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Navbar />
      <Footer />
    </MemoryRouter>,
  );
  const menu = screen.getByRole('navigation');
  expect(within(menu).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  expect(within(menu).queryByRole('link', { name: 'My Account' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
  expect(screen.getByRole('button', { name: 'Close navigation menu' })).toHaveAttribute('aria-expanded', 'true');
  expect(within(menu).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Officer access' }))
    .toHaveAttribute('href', '/officer-access');
  fireEvent.click(within(menu).getByRole('link', { name: 'Join Us' }));
  expect(screen.getByRole('button', { name: 'Open navigation menu' })).toHaveAttribute('aria-expanded', 'false');
});
