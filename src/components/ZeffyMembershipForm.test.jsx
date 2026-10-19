/* eslint-env jest */
import React, { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ZeffyMembershipForm from './ZeffyMembershipForm';

const LOADER = 'https://www.zeffy.com/embed/v2/zeffy-embed.js';
const EMBED = 'https://www.zeffy.com/embed/ticketing/mid-peninsula-running-clubs-membership';
const loader = () => document.querySelector(`script[src="${LOADER}"]`);

test('mounts the supplied Zeffy loader and fixed form without loading a duplicate checkout', () => {
  const { container } = render(<ZeffyMembershipForm />);
  expect(loader().async).toBe(true);
  expect(container.querySelector('[data-zeffy-embed]'))
    .toHaveAttribute('data-form-url', '/embed/ticketing/mid-peninsula-running-clubs-membership');
  const fallback = screen.getByTitle('MPRC membership form powered by Zeffy');
  expect(fallback).not.toHaveAttribute('src');
  expect(fallback).not.toBeVisible();
  expect(screen.getByRole('link', { name: /open the membership form/i }))
    .toHaveAttribute('href', 'https://www.zeffy.com/en-US/ticketing/mid-peninsula-running-clubs-membership');
});

test('does not activate the fallback when the main loader succeeds', () => {
  render(<ZeffyMembershipForm />);
  fireEvent.load(loader());
  expect(screen.getByTitle('MPRC membership form powered by Zeffy')).not.toHaveAttribute('src');
});

test('uses the supplied iframe fallback if the Zeffy script fails', () => {
  const { container } = render(<ZeffyMembershipForm />);
  fireEvent.error(loader());
  expect(container.querySelector('[data-zeffy-embed]')).not.toBeVisible();
  const fallback = screen.getByTitle('MPRC membership form powered by Zeffy');
  expect(fallback).toBeVisible();
  expect(fallback).toHaveAttribute('src', EMBED);
  expect(fallback).toHaveAttribute('allow', 'payment');
  fireEvent.error(loader());
  expect(container.querySelectorAll(`iframe[src="${EMBED}"]`)).toHaveLength(1);
});

test('removes the loader and vendor children on navigation, then initializes a fresh embed', () => {
  const first = render(<ZeffyMembershipForm />);
  const embed = first.container.querySelector('[data-zeffy-embed]');
  embed.appendChild(document.createElement('iframe'));
  const oldScript = loader();
  first.unmount();
  expect(loader()).toBeNull();
  expect(oldScript.onerror).toBeNull();
  expect(embed.childElementCount).toBe(0);
  const second = render(<ZeffyMembershipForm />);
  expect(loader()).not.toBe(oldScript);
  expect(second.container.querySelector('[data-zeffy-embed]')).toBeVisible();
  expect(screen.getByTitle('MPRC membership form powered by Zeffy')).not.toHaveAttribute('src');
});

test('keeps one active loader during React StrictMode setup and cleanup', () => {
  render(<StrictMode><ZeffyMembershipForm /></StrictMode>);
  expect(document.querySelectorAll(`script[src="${LOADER}"]`)).toHaveLength(1);
});

test('labels staging as a view-only preview of the real provider form', () => {
  const original = process.env.REACT_APP_FIREBASE_ENVIRONMENT;
  process.env.REACT_APP_FIREBASE_ENVIRONMENT = 'staging';
  try {
    render(<ZeffyMembershipForm />);
    expect(screen.getByText(/do not submit details or pay/)).toBeVisible();
  } finally {
    if (original === undefined) delete process.env.REACT_APP_FIREBASE_ENVIRONMENT;
    else process.env.REACT_APP_FIREBASE_ENVIRONMENT = original;
  }
});
