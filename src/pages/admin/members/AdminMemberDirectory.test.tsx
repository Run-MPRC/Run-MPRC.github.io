/* eslint-env jest */

import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import {
  act, fireEvent, render, screen, waitFor, within,
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
const QUERY_REQUIREMENT_FOR_TEST = 'Enter a longer name prefix using letters or numbers. Normalized search text may contain 2 to 80 characters.';
const app = { name: 'synthetic-app' } as any;
const otherApp = { name: 'other-synthetic-app' } as any;
const photo = {
  contentType: 'image/webp' as const,
  base64Data: btoa('RIFF0000WEBPsynthetic-processed-pixels'),
  width: 256 as const,
  height: 256 as const,
  version: REQUEST_ID,
};
const replacementPhoto = {
  ...photo,
  base64Data: btoa('RIFF1111WEBPreplacement-synthetic-pixels'),
  version: '223e4567-e89b-42d3-a456-426614174001',
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

  test('ties validation and fixed search failures to the search input', async () => {
    renderDirectory();

    const input = queryInput();
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input).toHaveAttribute(
      'aria-describedby',
      'member-directory-query-help',
    );

    submitSearch('x');

    const validation = screen.getByRole('alert');
    expect(validation).toHaveAttribute('id', 'member-directory-query-validation');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(
      'member-directory-query-help',
    );
    expect(input.getAttribute('aria-describedby')).toContain(
      'member-directory-query-validation',
    );

    fireEvent.change(input, { target: { value: 'synthetic' } });
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input.getAttribute('aria-describedby')).not.toContain(
      'member-directory-query-validation',
    );

    (searchMemberDirectory as jest.Mock).mockRejectedValue(new Error('synthetic'));
    fireEvent.submit(input.closest('form') as HTMLFormElement);

    const failure = await screen.findByText(
      'We could not complete that people-finder search. No results are shown. Try again later.',
    );
    expect(failure).toHaveAttribute('id', 'member-directory-search-failure');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(input.getAttribute('aria-describedby')).toContain(
      'member-directory-query-help',
    );
    expect(input.getAttribute('aria-describedby')).toContain(
      'member-directory-search-failure',
    );
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
    expect(screen.getByText(
      'No result cards are available for that name prefix. Try a longer prefix if you expected someone.',
    )).toHaveAttribute('role', 'status');
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
    expect(screen.getByRole('img', {
      name: 'Profile photo unavailable for Synthetic Runner',
    })).toHaveTextContent('Photo unavailable');
  });

  test('announces non-empty completion politely without exposing a result total', async () => {
    (searchMemberDirectory as jest.Mock).mockResolvedValue({
      schemaVersion: 1,
      results: [
        { entryRef: ENTRY_REF, displayName: 'Synthetic Runner', photo: null },
        { entryRef: SECOND_ENTRY_REF, displayName: 'Second Synthetic', photo: null },
      ],
    });
    renderDirectory();

    submitSearch();

    const completion = await screen.findByText(
      'Search complete. Matching result cards are available below.',
    );
    expect(completion).toHaveAttribute('role', 'status');
    expect(completion).toHaveAttribute('aria-live', 'polite');
    expect(completion).toHaveAttribute('aria-atomic', 'true');
    expect(completion).not.toHaveTextContent(/\b2\b|\btwo\b/i);
    const results = screen.getByRole('list', {
      name: 'Opted-in People finder results',
    });
    expect(results).toBeInTheDocument();
    expect(within(results).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText(/\b2 results\b/i)).not.toBeInTheDocument();
  });

  test('keeps connected and preview search controls contained and touch-sized on narrow screens', () => {
    const connected = renderDirectory();

    const connectedInput = queryInput();
    const connectedButton = screen.getByRole('button', { name: 'Search' });
    expect(connectedInput).toHaveClass('min-h-11', 'min-w-0', 'w-full', 'max-w-full');
    expect(connectedButton).toHaveClass('min-h-11', 'w-full', 'sm:w-auto');
    expect(connectedInput.closest('form')).toHaveClass('min-w-0');
    connected.unmount();

    renderDirectory({ backendAvailable: false });
    const previewInput = queryInput();
    const previewButton = screen.getByRole('button', { name: 'Search' });
    expect(previewInput).toBeDisabled();
    expect(previewInput).toHaveClass('min-h-11', 'min-w-0', 'w-full', 'max-w-full');
    expect(previewButton).toBeDisabled();
    expect(previewButton).toHaveClass('min-h-11', 'w-full', 'sm:w-auto');
    expect(previewInput.closest('form')).toHaveClass('min-w-0');
  });

  test('uses scoped explicit colors instead of unavailable Tailwind palette utilities', () => {
    renderDirectory();

    expect(queryInput()).toHaveClass('member-directory-admin__input');
    expect(queryInput().closest('form')).toHaveClass(
      'member-directory-admin__search',
    );
    expect(screen.getByRole('button', { name: 'Search' })).toHaveClass(
      'member-directory-admin__button',
    );

    const css = readFileSync(
      join(__dirname, '../../account/Account.css'),
      'utf8',
    );
    expect(css).toMatch(
      /\.member-directory-admin__search,[\s\S]*background:\s*#f9fafb;/,
    );
    expect(css).toMatch(
      /\.member-directory-admin__input\s*\{[\s\S]*color:\s*#111827;[\s\S]*background:\s*#fff;/,
    );
    expect(css).toMatch(
      /\.member-directory-admin__button\s*\{[\s\S]*color:\s*#fff;[\s\S]*background:\s*#1e40af;/,
    );
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

  describe('MEMBERS-DIRECTORY-001G clear-results and thumbnail recovery contract', () => {
    test('distinguishes absent and unavailable photos and retries a different photo version', async () => {
      (searchMemberDirectory as jest.Mock)
        .mockResolvedValueOnce({
          schemaVersion: 1,
          results: [
            { entryRef: ENTRY_REF, displayName: 'Synthetic Runner', photo },
            { entryRef: SECOND_ENTRY_REF, displayName: 'No Photo Runner', photo: null },
          ],
        })
        .mockResolvedValueOnce({
          schemaVersion: 1,
          results: [
            {
              entryRef: ENTRY_REF,
              displayName: 'Synthetic Runner',
              photo: replacementPhoto,
            },
          ],
        });
      renderDirectory();

      submitSearch('synthetic');

      const firstImage = await screen.findByRole('img', {
        name: 'Profile thumbnail for Synthetic Runner',
      });
      expect(screen.getByRole('img', { name: 'No profile photo for No Photo Runner' }))
        .toHaveTextContent('No photo');
      fireEvent.error(firstImage);

      expect(screen.queryByRole('img', {
        name: 'Profile thumbnail for Synthetic Runner',
      })).not.toBeInTheDocument();
      expect(firstImage).not.toBeInTheDocument();
      expect(document.querySelector(`img[src="data:image/webp;base64,${photo.base64Data}"]`))
        .toBeNull();
      expect(screen.getByRole('img', {
        name: 'Profile photo unavailable for Synthetic Runner',
      })).toHaveTextContent('Photo unavailable');
      expect(screen.queryByRole('img', {
        name: 'No profile photo for Synthetic Runner',
      })).not.toBeInTheDocument();

      submitSearch('replacement');

      const replacementImage = await screen.findByRole('img', {
        name: 'Profile thumbnail for Synthetic Runner',
      });
      expect(replacementImage).toHaveAttribute(
        'src',
        `data:image/webp;base64,${replacementPhoto.base64Data}`,
      );
      expect(screen.queryByRole('img', {
        name: 'Profile photo unavailable for Synthetic Runner',
      })).not.toBeInTheDocument();
    });

    test.each([
      ['completed validation', 'x', 'validation'],
      ['empty completion', 'synthetic-empty', 'empty'],
      ['fixed failure', 'synthetic-failure', 'failure'],
      ['result cards', 'synthetic-results', 'results'],
    ])('clears query and rendered state after %s without making another request', async (
      _label,
      query,
      outcome,
    ) => {
      if (outcome === 'failure') {
        (searchMemberDirectory as jest.Mock).mockRejectedValueOnce(
          new Error('made-up-service-failure'),
        );
      } else if (outcome === 'results') {
        (searchMemberDirectory as jest.Mock).mockResolvedValueOnce({
          schemaVersion: 1,
          results: [{
            entryRef: ENTRY_REF,
            displayName: 'Synthetic Clear Runner',
            photo,
          }],
        });
      }
      renderDirectory();

      submitSearch(query);

      if (outcome === 'validation') {
        await screen.findByText(QUERY_REQUIREMENT_FOR_TEST);
      } else if (outcome === 'empty') {
        await screen.findByText(
          'No result cards are available for that name prefix. Try a longer prefix if you expected someone.',
        );
      } else if (outcome === 'failure') {
        await screen.findByText(
          'We could not complete that people-finder search. No results are shown. Try again later.',
        );
      } else {
        await screen.findByText('Synthetic Clear Runner');
        expect(screen.getByRole('img', {
          name: 'Profile thumbnail for Synthetic Clear Runner',
        })).toHaveAttribute('src', `data:image/webp;base64,${photo.base64Data}`);
        expect(screen.getByText(
          'Search complete. Matching result cards are available below.',
        )).toBeInTheDocument();
      }

      const clear = screen.getByRole('button', {
        name: 'Clear search and result cards',
      });
      const requestIdCalls = (createMemberDirectorySearchRequestId as jest.Mock).mock.calls.length;
      const serviceCalls = (searchMemberDirectory as jest.Mock).mock.calls.length;
      fireEvent.click(clear);

      expect(queryInput()).toHaveValue('');
      expect(queryInput()).toHaveFocus();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 2, name: 'Opted-in people' }))
        .not.toBeInTheDocument();
      expect(screen.queryByText('Synthetic Clear Runner')).not.toBeInTheDocument();
      expect(document.querySelector(`img[src="data:image/webp;base64,${photo.base64Data}"]`))
        .toBeNull();
      expect(screen.queryByText(
        'Search complete. Matching result cards are available below.',
      )).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Search field and displayed result cards cleared.',
      );
      expect(screen.getByRole('status')).not.toHaveTextContent(query);
      expect(screen.queryByRole('button', {
        name: 'Clear search and result cards',
      })).not.toBeInTheDocument();
      expect(createMemberDirectorySearchRequestId).toHaveBeenCalledTimes(requestIdCalls);
      expect(searchMemberDirectory).toHaveBeenCalledTimes(serviceCalls);
    });

    test('does not offer clearing while the finder is idle or pending', async () => {
      const pending = deferred<{ schemaVersion: 1; results: [] }>();
      (searchMemberDirectory as jest.Mock).mockReturnValueOnce(pending.promise);
      renderDirectory();

      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      expect(screen.queryByRole('button', {
        name: 'Clear search and result cards',
      })).not.toBeInTheDocument();
      submitSearch('synthetic');
      expect(screen.getByRole('button', { name: 'Searching...' })).toBeDisabled();
      expect(screen.queryByRole('button', {
        name: 'Clear search and result cards',
      })).not.toBeInTheDocument();

      await act(async () => {
        pending.resolve({ schemaVersion: 1, results: [] });
        await pending.promise;
      });
      expect(screen.getByRole('button', {
        name: 'Clear search and result cards',
      })).toBeInTheDocument();
    });

    test('keeps native keyboard activation plus secondary contrast, focus, and 320px containment', async () => {
      renderDirectory();
      submitSearch('x');

      const clear = screen.getByRole('button', {
        name: 'Clear search and result cards',
      });
      expect(clear).toHaveClass(
        'member-directory-admin__button--secondary',
        'min-h-11',
        'max-w-full',
      );
      expect(clear.tagName).toBe('BUTTON');
      expect(clear).toHaveAttribute('type', 'button');
      expect(clear.closest('.member-directory-admin__actions')).not.toBeNull();
      clear.focus();
      fireEvent.keyDown(clear, { key: 'Enter', code: 'Enter', charCode: 13 });
      fireEvent.click(clear);
      fireEvent.keyUp(clear, { key: 'Enter', code: 'Enter', charCode: 13 });
      expect(queryInput()).toHaveFocus();
      expect(queryInput()).toHaveValue('');
      expect(screen.getByRole('status')).toHaveTextContent(
        'Search field and displayed result cards cleared.',
      );

      const css = readFileSync(
        join(__dirname, '../../account/Account.css'),
        'utf8',
      );
      expect(css).toMatch(
        /\.member-directory-admin__button--secondary\s*\{[\s\S]*min-height:\s*2\.75rem;[\s\S]*color:\s*#1e3a8a;[\s\S]*background:\s*#fff;[\s\S]*border-color:\s*#1e40af;/,
      );
      expect(css).toMatch(
        /\.member-directory-admin__button--secondary:focus-visible\s*\{[\s\S]*outline:\s*3px solid #1e40af;[\s\S]*outline-offset:\s*3px;/,
      );
      expect(css).toMatch(
        /@media \(max-width:\s*320px\)\s*\{[\s\S]*\.member-directory-admin__actions\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*width:\s*100%;[\s\S]*\.member-directory-admin__button--secondary\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;/,
      );
    });
  });
});
