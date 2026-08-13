/* eslint-env jest */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import MemberDirectoryProfilePreview from './MemberDirectoryProfilePreview';

test('renders an inert profile-photo and finder-choice preview', () => {
  render(<MemberDirectoryProfilePreview hasDisplayName />);

  expect(screen.getByRole('heading', {
    level: 2,
    name: 'Profile photo and officer finder',
  })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Interface preview — not connected yet.',
  );
  expect(screen.getByLabelText('Profile photo preview')).toBeInTheDocument();

  const file = screen.getByLabelText('Add profile photo (not available yet)');
  const choice = screen.getByRole('checkbox', {
    name: 'Let authorized officers find me by name (not available yet)',
  });
  expect(file).toBeDisabled();
  expect(file).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  expect(choice).toBeDisabled();
  expect(choice).not.toBeChecked();

  fireEvent.change(file, {
    target: { files: [new File(['synthetic'], 'synthetic.png', { type: 'image/png' })] },
  });
  fireEvent.click(choice);

  expect(choice).not.toBeChecked();
  expect(screen.getByText(/will not accept a photo as a query/i)).toBeInTheDocument();
  expect(screen.getByText(/facial recognition or image matching/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /upload|remove|save/i }))
    .not.toBeInTheDocument();
});

test('keeps a missing name as a future prerequisite without enabling the choice', () => {
  render(<MemberDirectoryProfilePreview hasDisplayName={false} />);

  const choice = screen.getByRole('checkbox', {
    name: 'Let authorized officers find me by name (not available yet)',
  });
  expect(choice).toBeDisabled();
  expect(choice.getAttribute('aria-describedby')).toContain(
    'member-directory-name-required-preview',
  );
  expect(screen.getByText(/full name in the Profile section will also be required/i))
    .toBeInTheDocument();
});

test('has no directory-service boundary and includes narrow-screen containment', () => {
  const source = readFileSync(join(__dirname, 'MemberDirectoryProfilePreview.tsx'), 'utf8');
  const css = readFileSync(
    join(__dirname, '../../assets/styles/memberDirectoryPreview.css'),
    'utf8',
  );

  expect(source).not.toMatch(/firebase|ServiceLocator|memberDirectoryService|requestId|FileReader/);
  expect(css).toMatch(/\.member-directory-preview\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
  expect(css).toMatch(/\.member-directory-preview__photo-row\s*\{[\s\S]*flex-wrap:\s*wrap;[\s\S]*width:\s*100%;/);
  expect(css).toMatch(/\.member-directory-preview__photo-actions\s*\{[\s\S]*min-width:\s*0;[\s\S]*width:\s*100%;/);
});
