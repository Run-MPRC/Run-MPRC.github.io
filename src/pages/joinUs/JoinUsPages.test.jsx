/* eslint-env jest */

import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import JoinUsConditionalRoute from './JoinUsConditionalRoute';
import RunWithUs from './RunWithUs';
import { links } from '../../data';
import { APPLE_CALENDAR_ICS_LINK, GOOGLE_CALENDAR_ADD_LINK } from '../../text/externalLinks';

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

test('Join The Club is the membership page and links only to the Zeffy membership form', () => {
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
  expect(screen.getByRole('link', { name: 'Join The Club' })).toHaveAttribute('href', '/joinus');
});

test('Run With Us shows meeting details, then the waiver notice, the waiver and the route map', () => {
  renderPage(<RunWithUs />);

  const notice = screen.getByText('You must sign waiver below');
  const waiverHeading = screen.getByRole('heading', { name: 'Club Activity Waiver' });
  const inPageOrder = [
    screen.getByRole('heading', { name: 'Ways To Run With Us' }),
    screen.getByRole('link', { name: 'Get Directions To Our Meeting Location' }),
    notice,
    waiverHeading,
    screen.getByRole('link', { name: 'Sign Waiver Form' }),
    screen.getByTestId('route-map'),
  ];
  const everyElement = Array.from(document.body.querySelectorAll('*'));
  const positions = inPageOrder.map((element) => everyElement.indexOf(element));

  expect(positions).not.toContain(-1);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  // The notice sits directly above the waiver card it points to.
  expect(notice.closest('p').nextElementSibling).toContainElement(waiverHeading);
});

test('Run With Us offers the Saturday run for Google Calendar and Apple Calendar', () => {
  renderPage(<RunWithUs />);

  expect(screen.getByRole('link', { name: 'Add to Google Calendar' }))
    .toHaveAttribute('href', GOOGLE_CALENDAR_ADD_LINK);

  const appleLink = screen.getByRole('link', { name: 'Add to Apple Calendar' });
  expect(appleLink).toHaveAttribute('href', '/mprc-saturday-run.ics');
  expect(APPLE_CALENDAR_ICS_LINK).toBe('/mprc-saturday-run.ics');
  // Opened in place so Safari hands the file to Calendar.
  expect(appleLink).not.toHaveAttribute('target');
  expect(appleLink).not.toHaveAttribute('download');
});

test('the Apple Calendar file is a well-formed weekly event that matches the Google Calendar link', () => {
  const file = fs.readFileSync(path.join(process.cwd(), 'public', APPLE_CALENDAR_ICS_LINK));
  const text = file.toString('utf8');

  // Calendar files need CRLF line endings and lines of at most 75 bytes.
  const physicalLines = text.split('\r\n');
  expect(physicalLines.pop()).toBe('');
  physicalLines.forEach((line) => {
    expect(line).not.toMatch(/[\r\n]/);
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });

  const lines = text.replace(/\r\n /g, '').split('\r\n');
  const valueOf = (name) => {
    const line = lines.find((candidate) => candidate.startsWith(`${name}:`));
    return line.slice(name.length + 1).replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
  };
  const compactUtc = (localPacificStandardTime) => new Date(`${localPacificStandardTime}-08:00`)
    .toISOString().replace(/[-:]|\.000/g, '');

  expect(lines[0]).toBe('BEGIN:VCALENDAR');
  expect(lines).toEqual(expect.arrayContaining([
    'VERSION:2.0',
    'TZID:America/Los_Angeles',
    'DTSTART;TZID=America/Los_Angeles:20260131T084500',
    'DTEND;TZID=America/Los_Angeles:20260131T103000',
    'RRULE:FREQ=WEEKLY;BYDAY=SA',
    'END:VEVENT',
  ]));
  expect(lines[lines.length - 2]).toBe('END:VCALENDAR');
  expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);

  // Same event as the Google Calendar link: title, place, description and time.
  const google = new URL(GOOGLE_CALENDAR_ADD_LINK).searchParams;
  expect(valueOf('SUMMARY')).toBe(google.get('text'));
  expect(valueOf('LOCATION')).toBe(google.get('location'));
  expect(valueOf('DESCRIPTION')).toBe(google.get('details'));
  expect(`${compactUtc('2026-01-31T08:45:00')}/${compactUtc('2026-01-31T10:30:00')}`)
    .toBe(google.get('dates'));
  expect(google.get('recur')).toBe('RRULE:FREQ=WEEKLY;BYDAY=SA');

  // No organizer, attendee or mailbox in a public file.
  expect(text).not.toMatch(/ORGANIZER|ATTENDEE|mailto:/i);
});

test('navigation lists Join The Club and Run With Us as separate pages', () => {
  expect(links).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Join The Club', path: '/joinus' }),
    expect.objectContaining({ name: 'Run With Us', path: '/run-with-us' }),
  ]));
});
