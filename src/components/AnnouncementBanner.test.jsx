/* eslint-env jest */

import React from 'react';
import { render, screen } from '@testing-library/react';
import AnnouncementBanner from './AnnouncementBanner';

const SEPTEMBER_19_NOTICE = /Sept\. 19, 8:45 AM:/i;
const SEPTEMBER_26_NOTICE = /Sept\. 26, 8:45 AM:/i;

function renderAt(isoDate) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(isoDate));
  render(<AnnouncementBanner />);
}

afterEach(() => {
  jest.useRealTimers();
});

test('shows both temporary meeting locations before September 20 Pacific', () => {
  renderAt('2026-09-19T23:59:59-07:00');

  expect(screen.getByRole('region', {
    name: /temporary saturday meeting locations/i,
  })).toBeInTheDocument();
  expect(screen.getByText(SEPTEMBER_19_NOTICE)).toBeInTheDocument();
  expect(screen.getByText(SEPTEMBER_26_NOTICE)).toBeInTheDocument();
  expect(screen.getByRole('link', {
    name: /restrooms next to the seal point dog park/i,
  })).toHaveAttribute(
    'href',
    'https://www.google.com/maps/search/?api=1&query=37.5733685%2C-122.3007770',
  );
  expect(screen.getByRole('link', {
    name: /the kite school in baywinds park/i,
  })).toHaveAttribute('href', 'https://maps.app.goo.gl/eWoXjkF2Brt8ujh88');
});

test('removes the September 19 item after that Saturday', () => {
  renderAt('2026-09-20T00:00:00-07:00');

  expect(screen.queryByText(SEPTEMBER_19_NOTICE)).not.toBeInTheDocument();
  expect(screen.getByText(SEPTEMBER_26_NOTICE)).toBeInTheDocument();
});

test('keeps the September 26 item through the end of that Saturday', () => {
  renderAt('2026-09-26T23:59:59-07:00');

  expect(screen.getByText(SEPTEMBER_26_NOTICE)).toBeInTheDocument();
});

test('removes the announcement after September 26 Pacific', () => {
  renderAt('2026-09-27T00:00:00-07:00');

  expect(screen.queryByRole('region', {
    name: /temporary saturday meeting locations/i,
  })).not.toBeInTheDocument();
});
