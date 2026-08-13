/* eslint-env jest */

import React from 'react';
import {
  act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useServiceLocator } from '../../../services/ServiceLocatorContext';
import { useAuth } from '../../../services/hooks/useAuth';
import {
  createMemberDirectorySearchRequestId,
  searchMemberDirectory,
} from '../../../services/account/memberDirectorySearchService';
import AdminMemberDirectory from './AdminMemberDirectory';

jest.mock('../../../services/ServiceLocatorContext', () => ({
  useServiceLocator: jest.fn(),
}));

jest.mock('../../../services/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../services/account/memberDirectorySearchService', () => {
  const actual = jest.requireActual('../../../services/account/memberDirectorySearchService');
  return {
    ...actual,
    createMemberDirectorySearchRequestId: jest.fn(),
    searchMemberDirectory: jest.fn(),
  };
});

jest.mock('../../../components/SEO', () => function SEO() {
  return null;
});

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const ENTRY_REF = `entry_${'a'.repeat(64)}`;
const SECOND_ENTRY_REF = `entry_${'b'.repeat(64)}`;
const app = { name: 'synthetic-app' } as any;
const otherApp = { name: 'other-synthetic-app' } as any;
const photo = {
  contentType: 'image/webp' as const,
  base64Data: btoa('RIFF0000WEBPsynthetic-processed-pixels'),
  width: 256 as const,
  height: 256 as const,
  version: REQUEST_ID,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function setContext(firebaseApp: typeof app | null = app, uid: string | null = 'admin-one') {
  (useServiceLocator as jest.Mock).mockReturnValue({
    services: firebaseApp ? { firebaseResources: { app: firebaseApp } } : null,
    isReady: firebaseApp !== null,
  });
  (useAuth as jest.Mock).mockReturnValue({
    user: uid ? { uid } : null,
    isLoading: false,
    isAuthenticated: true,
    isAdmin: true,
  });
}

function renderDirectory({
  backendAvailable = true,
}: {
  backendAvailable?: boolean;
} = {}) {
  return render(
    <MemoryRouter
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      initialEntries={['/admin/member-directory']}
    >
      <AdminMemberDirectory backendAvailable={backendAvailable} />
    </MemoryRouter>,
  );
}

function queryInput() {
  return screen.getByRole('textbox', { name: 'Search opted-in people by name' });
}

function submitSearch(value = 'synthetic') {
  const input = queryInput();
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form') as HTMLFormElement);
}

describe('Admin People finder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setContext();
    (createMemberDirectorySearchRequestId as jest.Mock).mockReturnValue(REQUEST_ID);
    (searchMemberDirectory as jest.Mock).mockResolvedValue({
      schemaVersion: 1,
      results: [],
    });
  });

  test('defaults to a guarded inert preview without obtaining directory context', () => {
    (useServiceLocator as jest.Mock).mockImplementation(() => {
      throw new Error('preview-must-not-obtain-directory-context');
    });
    render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={['/admin/member-directory']}
      >
        <AdminMemberDirectory />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'People finder' }))
      .toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Interface preview — search is not connected.',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'No finder name is collected or sent, and no member-directory profiles or results are loaded.',
    );
    const input = queryInput();
    const search = screen.getByRole('button', { name: 'Search' });
    expect(input).toBeDisabled();
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input.getAttribute('aria-describedby')).toContain(
      'member-directory-search-preview-status',
    );
    expect(search).toBeDisabled();
    expect(search.getAttribute('aria-describedby')).toContain(
      'member-directory-search-preview-status',
    );
    expect(screen.getByText(/when connected, search by the beginning/i))
      .toBeInTheDocument();
    expect(screen.getByText(/does not accept a photo as a query/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Opted-in people' }))
      .not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    fireEvent.change(input, { target: { value: 'Synthetic Runner' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    expect(useServiceLocator).not.toHaveBeenCalled();
    expect(createMemberDirectorySearchRequestId).not.toHaveBeenCalled();
    expect(searchMemberDirectory).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent(
      'preview-must-not-obtain-directory-context',
    );
  });

  test('explains the bounded opt-in finder and waits for explicit submit', () => {
    renderDirectory();

    expect(screen.getByRole('heading', { level: 1, name: 'People finder' }))
      .toBeInTheDocument();
    expect(screen.getByText(/only website-account holders who turned on/i))
      .toBeInTheDocument();
    expect(screen.getByText(/does not prove current club membership, payment, eligibility/i))
      .toBeInTheDocument();
    expect(screen.getByText(/does not accept a photo as a query/i)).toBeInTheDocument();
    expect(screen.getByText(/does not use facial recognition, image matching, fuzzy matching/i))
      .toBeInTheDocument();
    expect(queryInput()).toHaveAttribute('autocomplete', 'off');
    expect(queryInput()).not.toHaveAttribute('minlength');
    expect(queryInput()).toHaveAttribute('maxlength', '512');
    expect(document.querySelector('input[type="file"]')).toBeNull();

    fireEvent.change(queryInput(), { target: { value: 'Synthetic' } });
    expect(searchMemberDirectory).not.toHaveBeenCalled();
    expect(createMemberDirectorySearchRequestId).not.toHaveBeenCalled();
  });

  test.each([
    ['one character', 'x'],
    ['one token character followed by punctuation', 'A!'],
    ['more than 80 normalized code units', 'x'.repeat(81)],
    ['a Unicode C1 control', 'Sy\u0085nthetic'],
    ['a format control', 'Sy\u200dnthetic'],
    ['punctuation only', '--'],
  ])('rejects %s locally without creating an identifier or request', (_label, value) => {
    renderDirectory();

    submitSearch(value);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter a longer name prefix using letters or numbers. Normalized search text may contain 2 to 80 characters.',
    );
    expect(createMemberDirectorySearchRequestId).not.toHaveBeenCalled();
    expect(searchMemberDirectory).not.toHaveBeenCalled();
  });

  test('normalizes one explicit request and blocks duplicate submissions while pending', async () => {
    const pending = deferred<{ schemaVersion: 1; results: [] }>();
    (searchMemberDirectory as jest.Mock).mockReturnValue(pending.promise);
    renderDirectory();

    submitSearch('  Ｓynthetic   Runner ');

    expect(createMemberDirectorySearchRequestId).toHaveBeenCalledTimes(1);
    expect(searchMemberDirectory).toHaveBeenCalledWith(app, {
      requestId: REQUEST_ID,
      query: 'Synthetic Runner',
    });
    expect(queryInput()).toHaveValue('Synthetic Runner');
    expect(queryInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Searching...' })).toBeDisabled();
    fireEvent.submit(queryInput().closest('form') as HTMLFormElement);
    expect(searchMemberDirectory).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ schemaVersion: 1, results: [] });
      await pending.promise;
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'No result cards are available for that name prefix. Try a longer prefix if you expected someone.',
    );
  });

  test('renders only the voluntary name/photo card fields and falls back on image failure', async () => {
    (searchMemberDirectory as jest.Mock).mockResolvedValue({
      schemaVersion: 1,
      results: [
        { entryRef: ENTRY_REF, displayName: 'Synthetic Runner', photo },
        { entryRef: SECOND_ENTRY_REF, displayName: 'No Photo Runner', photo: null },
      ],
    });
    renderDirectory();

    submitSearch();

    const firstHeading = await screen.findByRole('heading', {
      level: 3,
      name: 'Synthetic Runner',
    });
    expect(firstHeading).toBeInTheDocument();
    expect(firstHeading.querySelector('bdi')).toHaveAttribute('dir', 'auto');
    expect(screen.getByRole('heading', { level: 3, name: 'No Photo Runner' }))
      .toBeInTheDocument();
    expect(screen.queryByText(/\b2 results\b/i)).not.toBeInTheDocument();
    const image = screen.getByRole('img', {
      name: 'Profile thumbnail for Synthetic Runner',
    });
    expect(image).toHaveAttribute('src', `data:image/webp;base64,${photo.base64Data}`);
    expect(screen.getByRole('img', { name: 'No profile photo for No Photo Runner' }))
      .toHaveTextContent('No photo');
    expect(document.body).not.toHaveTextContent(ENTRY_REF);
    expect(document.body).not.toHaveTextContent(SECOND_ENTRY_REF);

    fireEvent.error(image);
    expect(screen.getByRole('img', { name: 'No profile photo for Synthetic Runner' }))
      .toHaveTextContent('No photo');
  });

  test('clears earlier results as soon as the next input changes', async () => {
    (searchMemberDirectory as jest.Mock).mockResolvedValue({
      schemaVersion: 1,
      results: [{ entryRef: ENTRY_REF, displayName: 'Synthetic Runner', photo: null }],
    });
    renderDirectory();
    submitSearch();
    expect(await screen.findByText('Synthetic Runner')).toBeInTheDocument();

    fireEvent.change(queryInput(), { target: { value: 'different' } });

    expect(screen.queryByText('Synthetic Runner')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Opted-in people' }))
      .not.toBeInTheDocument();
  });

  test('contains rejected values behind a fixed failure with no old results', async () => {
    (searchMemberDirectory as jest.Mock).mockRejectedValue(
      Object.assign(new Error('synthetic-private-query-canary'), {
        details: { names: ['private-result-canary'] },
      }),
    );
    renderDirectory();

    submitSearch();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not complete that people-finder search. No results are shown. Try again later.',
    );
    expect(document.body).not.toHaveTextContent('synthetic-private-query-canary');
    expect(document.body).not.toHaveTextContent('private-result-canary');
    expect(screen.queryByRole('heading', { level: 2, name: 'Opted-in people' }))
      .not.toBeInTheDocument();
  });

  test('contains completion from an old Firebase app and admin account context', async () => {
    const pending = deferred<any>();
    (searchMemberDirectory as jest.Mock).mockReturnValueOnce(pending.promise);
    const view = renderDirectory();
    submitSearch('synthetic');
    expect(searchMemberDirectory).toHaveBeenCalledWith(app, expect.any(Object));

    setContext(otherApp, 'admin-two');
    view.rerender(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={['/admin/member-directory']}
      >
        <AdminMemberDirectory backendAvailable />
      </MemoryRouter>,
    );
    expect(queryInput()).toHaveValue('');

    await act(async () => {
      pending.resolve({
        schemaVersion: 1,
        results: [{ entryRef: ENTRY_REF, displayName: 'Stale Runner', photo: null }],
      });
      await pending.promise;
    });

    expect(screen.queryByText('Stale Runner')).not.toBeInTheDocument();
    expect(queryInput()).toHaveValue('');
    submitSearch('fresh');
    await waitFor(() => expect(searchMemberDirectory).toHaveBeenLastCalledWith(otherApp, {
      requestId: REQUEST_ID,
      query: 'fresh',
    }));
  });

  test('contains completion after unmount and shows a fixed setup failure without context', async () => {
    const pending = deferred<any>();
    (searchMemberDirectory as jest.Mock).mockReturnValue(pending.promise);
    const view = renderDirectory();
    submitSearch();
    view.unmount();

    await act(async () => {
      pending.resolve({
        schemaVersion: 1,
        results: [{ entryRef: ENTRY_REF, displayName: 'Unmounted Runner', photo: null }],
      });
      await pending.promise;
    });

    setContext(null, null);
    renderDirectory();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The People finder is unavailable right now. No results are shown.',
    );
  });
});
