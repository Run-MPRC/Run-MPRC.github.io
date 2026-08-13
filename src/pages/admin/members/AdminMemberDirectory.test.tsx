/* eslint-env jest */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { useAuth } from '../../../services/hooks/useAuth';
import AdminMemberDirectory from './AdminMemberDirectory';

jest.mock('../../../services/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../components/SEO', () => function SEO() {
  return null;
});

function renderRoute() {
  return render(
    <MemoryRouter
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      initialEntries={['/admin/member-directory']}
    >
      <Routes>
        <Route path="/login" element={<div>Login boundary</div>} />
        <Route path="/admin/member-directory" element={<AdminMemberDirectory />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({
    isLoading: false,
    isAuthenticated: true,
    isAdmin: true,
  });
});

test('keeps the People finder guarded and inert for an administrator', () => {
  renderRoute();

  expect(screen.getByRole('heading', { level: 1, name: 'People finder' }))
    .toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Interface preview — search is not connected.',
  );
  const input = screen.getByRole('textbox', {
    name: 'Search opted-in people by name',
  });
  expect(input).toBeDisabled();
  expect(input).toHaveValue('');
  expect(input).toHaveAttribute('autocomplete', 'off');
  expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  expect(screen.queryByRole('heading', { level: 2, name: /people|results/i }))
    .not.toBeInTheDocument();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  expect(screen.getByText(/will not accept a photo as a query/i)).toBeInTheDocument();
});

test('redirects a signed-out visitor through the existing guard', () => {
  (useAuth as jest.Mock).mockReturnValue({
    isLoading: false,
    isAuthenticated: false,
    isAdmin: false,
  });
  renderRoute();

  expect(screen.getByText('Login boundary')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 1, name: 'People finder' }))
    .not.toBeInTheDocument();
});

test('denies a signed-in non-admin through the existing guard', () => {
  (useAuth as jest.Mock).mockReturnValue({
    isLoading: false,
    isAuthenticated: true,
    isAdmin: false,
  });
  renderRoute();

  expect(screen.getByRole('heading', { level: 1, name: 'Admins only' }))
    .toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 1, name: 'People finder' }))
    .not.toBeInTheDocument();
});

test('imports no directory or Firebase service and the app declares one guarded route', () => {
  const source = readFileSync(join(__dirname, 'AdminMemberDirectory.tsx'), 'utf8');
  const appSource = readFileSync(join(__dirname, '../../../App.jsx'), 'utf8');

  expect(source).toMatch(/<AdminGuard>[\s\S]*<PeopleFinderPreview \/>[\s\S]*<\/AdminGuard>/);
  expect(source).not.toMatch(/firebase|ServiceLocator|memberDirectoryService|requestId/);
  expect(appSource).toMatch(/lazy\(\(\) => import\('\.\/pages\/admin\/members\/AdminMemberDirectory'\)\)/);
  expect(appSource).toMatch(/path="admin\/member-directory"/);
});

test('restores visible focus and readable colors for new navigation links', () => {
  const css = readFileSync(
    join(__dirname, '../../../assets/styles/memberDirectoryPreview.css'),
    'utf8',
  );
  const adminHome = readFileSync(join(__dirname, '../AdminHome.tsx'), 'utf8');
  const adminMembers = readFileSync(join(__dirname, 'AdminMembers.tsx'), 'utf8');

  expect(css).toMatch(
    /\.member-directory-preview__back-link:focus-visible,[\s\S]*outline:\s*3px solid #fff;[\s\S]*box-shadow:\s*0 0 0 6px #111827;/,
  );
  expect(css).toMatch(
    /\.member-directory-preview__nav-card\s*\{[\s\S]*color:\s*#111827;[\s\S]*background:\s*#fff;/,
  );
  expect(css).toMatch(
    /\.member-directory-preview__nav-card:hover\s*\{[\s\S]*color:\s*#111827;[\s\S]*background:\s*#eff6ff;/,
  );
  expect(css).toMatch(
    /\.member-directory-preview__inline-link\s*\{[\s\S]*color:\s*#1d4ed8;/,
  );
  expect(adminHome).toContain('member-directory-preview__nav-card');
  expect(adminMembers).toContain('member-directory-preview__inline-link');
});
