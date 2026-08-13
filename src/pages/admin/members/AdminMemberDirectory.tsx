import { FirebaseApp } from 'firebase/app';
import React, {
  FormEvent, useEffect, useRef, useState,
} from 'react';
import { Link } from 'react-router-dom';
import SEO from '../../../components/SEO';
import '../../account/Account.css';
import MEMBER_DIRECTORY_BACKEND_AVAILABLE from '../../../services/account/memberDirectoryAvailability';
import { useServiceLocator } from '../../../services/ServiceLocatorContext';
import {
  createMemberDirectorySearchRequestId,
  MemberDirectorySearchResult,
  normalizeMemberDirectorySearchQuery,
  searchMemberDirectory,
} from '../../../services/account/memberDirectorySearchService';
import { useAuth } from '../../../services/hooks/useAuth';
import AdminGuard from '../AdminGuard';

const QUERY_REQUIREMENT = 'Enter a longer name prefix using letters or numbers. Normalized search text may contain 2 to 80 characters.';
const SEARCH_FAILURE = 'We could not complete that people-finder search. No results are shown. Try again later.';
const SETUP_FAILURE = 'The People finder is unavailable right now. No results are shown.';

const appIdentities = new WeakMap<object, number>();
let nextAppIdentity = 1;

function appIdentity(app: object): number {
  const existing = appIdentities.get(app);
  if (existing !== undefined) return existing;
  const identity = nextAppIdentity;
  nextAppIdentity += 1;
  appIdentities.set(app, identity);
  return identity;
}

type SearchState =
  | { phase: 'idle' }
  | { phase: 'pending' }
  | { phase: 'resolved'; results: readonly MemberDirectorySearchResult[] }
  | { phase: 'unavailable' };

function PhotoFallback({
  displayName,
  unavailable = false,
}: {
  displayName: string;
  unavailable?: boolean;
}) {
  return (
    <div
      className="member-directory-admin__photo-fallback grid h-32 w-32 flex-none place-items-center rounded-lg border-2 border-gray-400 bg-gray-100 px-2 text-center text-sm font-semibold text-gray-700"
      role="img"
      aria-label={unavailable
        ? `Profile photo unavailable for ${displayName}`
        : `No profile photo for ${displayName}`}
    >
      {unavailable ? 'Photo unavailable' : 'No photo'}
    </div>
  );
}

function DirectoryPhoto({ result }: { result: MemberDirectorySearchResult }) {
  const [failed, setFailed] = useState(false);
  if (result.photo === null) {
    return <PhotoFallback displayName={result.displayName} />;
  }
  if (failed) {
    return <PhotoFallback displayName={result.displayName} unavailable />;
  }
  return (
    <img
      src={`data:${result.photo.contentType};base64,${result.photo.base64Data}`}
      width={128}
      height={128}
      className="h-32 w-32 flex-none rounded-lg border-2 border-gray-400 object-cover"
      alt={`Profile thumbnail for ${result.displayName}`}
      onError={() => setFailed(true)}
    />
  );
}

function SearchAttempt({ app }: { app: FirebaseApp }) {
  const [queryInput, setQueryInput] = useState('');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [state, setState] = useState<SearchState>({ phase: 'idle' });
  const [clearAnnouncement, setClearAnnouncement] = useState<string | null>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);
  const pendingRef = useRef(false);
  const operationRef = useRef<symbol | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRef.current = false;
      operationRef.current = null;
    };
  }, []);

  function handleQueryChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (pendingRef.current) return;
    operationRef.current = null;
    setQueryInput(event.currentTarget.value);
    setValidationMessage(null);
    setState({ phase: 'idle' });
    setClearAnnouncement(null);
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;

    const query = normalizeMemberDirectorySearchQuery(queryInput);
    if (query === null) {
      operationRef.current = null;
      setValidationMessage(QUERY_REQUIREMENT);
      setState({ phase: 'idle' });
      setClearAnnouncement(null);
      return;
    }

    let requestId: string;
    try {
      requestId = createMemberDirectorySearchRequestId();
    } catch {
      setValidationMessage(null);
      setState({ phase: 'unavailable' });
      setClearAnnouncement(null);
      return;
    }

    const operation = Symbol('member-directory-search');
    operationRef.current = operation;
    pendingRef.current = true;
    setQueryInput(query);
    setValidationMessage(null);
    setState({ phase: 'pending' });
    setClearAnnouncement(null);

    try {
      const response = await searchMemberDirectory(app, { requestId, query });
      if (!mountedRef.current || operationRef.current !== operation) return;
      setState({ phase: 'resolved', results: response.results });
    } catch {
      if (!mountedRef.current || operationRef.current !== operation) return;
      setState({ phase: 'unavailable' });
    } finally {
      if (mountedRef.current && operationRef.current === operation) {
        pendingRef.current = false;
      }
    }
  }

  function handleClear() {
    operationRef.current = null;
    setQueryInput('');
    setValidationMessage(null);
    setState({ phase: 'idle' });
    setClearAnnouncement('Search field and displayed result cards cleared.');
    queryInputRef.current?.focus();
  }

  const pending = state.phase === 'pending';
  const clearAvailable = validationMessage !== null
    || state.phase === 'resolved'
    || state.phase === 'unavailable';
  const queryDescriptionIds = [
    'member-directory-query-help',
    validationMessage ? 'member-directory-query-validation' : null,
    state.phase === 'unavailable' ? 'member-directory-search-failure' : null,
  ].filter(Boolean).join(' ');

  return (
    <>
      <form
        className="member-directory-admin__search mt-6 min-w-0 rounded-lg border border-gray-300 bg-gray-50 p-4"
        onSubmit={handleSearch}
        noValidate
      >
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
          <label
            htmlFor="member-directory-name-query"
            className="block min-w-0 flex-1"
          >
            <span
              id="member-directory-query-label"
              className="member-directory-admin__label block font-semibold text-gray-900"
            >
              Search opted-in people by name
            </span>
            <span
              id="member-directory-query-help"
              className="member-directory-admin__help mt-1 block text-sm text-gray-700"
            >
              Enter the beginning of a name or name part. Search runs only when you
              choose Search.
            </span>
            <input
              ref={queryInputRef}
              id="member-directory-name-query"
              name="member-directory-name-query"
              type="text"
              value={queryInput}
              onChange={handleQueryChange}
              disabled={pending}
              maxLength={512}
              autoComplete="off"
              spellCheck={false}
              aria-labelledby="member-directory-query-label"
              aria-describedby={queryDescriptionIds}
              aria-invalid={validationMessage !== null}
              className="member-directory-admin__input mt-3 block min-h-11 min-w-0 w-full max-w-full rounded border border-gray-500 bg-white px-3 py-2 text-gray-900"
            />
          </label>
          <div className="member-directory-admin__actions flex min-w-0 max-w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <button
              type="submit"
              disabled={pending}
              className="member-directory-admin__button min-h-11 w-full rounded border-2 border-blue-800 bg-blue-800 px-5 py-2 font-semibold text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {pending ? 'Searching...' : 'Search'}
            </button>
            {clearAvailable && (
              <button
                type="button"
                onClick={handleClear}
                className="member-directory-admin__button--secondary min-h-11 max-w-full rounded border-2 px-5 py-2 font-semibold"
              >
                Clear search and result cards
              </button>
            )}
          </div>
        </div>
      </form>

      <p
        className={clearAnnouncement ? 'mt-4 text-sm text-gray-700' : 'sr-only'}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {clearAnnouncement}
      </p>

      {validationMessage && (
        <p
          id="member-directory-query-validation"
          className="member-directory-admin__message member-directory-admin__message--warning mt-4 rounded border border-amber-600 bg-amber-50 p-3 text-sm text-amber-950"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {validationMessage}
        </p>
      )}

      {state.phase === 'pending' && (
        <p className="mt-4 text-sm text-gray-700" role="status" aria-live="polite">
          Searching the optional People finder...
        </p>
      )}

      {state.phase === 'unavailable' && (
        <p
          id="member-directory-search-failure"
          className="member-directory-admin__message member-directory-admin__message--error mt-4 rounded border border-red-700 bg-red-50 p-3 text-sm text-red-900"
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          {SEARCH_FAILURE}
        </p>
      )}

      {state.phase === 'resolved' && state.results.length === 0 && (
        <p className="mt-4 text-sm text-gray-700" role="status" aria-live="polite">
          No result cards are available for that name prefix. Try a longer prefix
          if you expected someone.
        </p>
      )}

      {state.phase === 'resolved' && state.results.length > 0 && (
        <section className="mt-6 min-w-0" aria-labelledby="member-directory-results-heading">
          <p
            className="text-sm text-gray-700"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            Search complete. Matching result cards are available below.
          </p>
          <h2 id="member-directory-results-heading" className="mt-2 text-xl font-bold text-gray-900">
            Opted-in people
          </h2>
          <ul
            className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="Opted-in People finder results"
          >
            {state.results.map((result) => (
              <li
                key={result.entryRef}
                className="member-directory-admin__card min-w-0 overflow-hidden rounded-lg border border-gray-300 bg-white p-4 text-gray-900"
              >
                <DirectoryPhoto
                  key={result.photo?.version ?? 'no-photo'}
                  result={result}
                />
                <h3 className="mt-3 max-w-full break-words text-lg font-bold text-gray-900">
                  <bdi dir="auto">{result.displayName}</bdi>
                </h3>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function MemberDirectoryPreview() {
  return (
    <>
      <div
        id="member-directory-search-preview-status"
        className="mt-6 max-w-3xl rounded-lg border-2 border-amber-700 bg-amber-50 p-4 text-amber-950"
        role="status"
      >
        <strong className="block">Interface preview — search is not connected.</strong>
        <span className="mt-1 block">
          No finder name is collected or sent, and no member-directory profiles or
          results are loaded.
        </span>
      </div>
      <form
        className="member-directory-admin__search mt-4 min-w-0 rounded-lg border border-gray-300 bg-gray-50 p-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
          <label
            htmlFor="member-directory-name-query-preview"
            className="block min-w-0 flex-1"
          >
            <span
              id="member-directory-query-label-preview"
              className="member-directory-admin__label block font-semibold text-gray-900"
            >
              Search opted-in people by name
            </span>
            <span
              id="member-directory-query-help-preview"
              className="member-directory-admin__help mt-1 block text-sm text-gray-700"
            >
              Name entry will be available after the protected backend is connected.
            </span>
            <input
              id="member-directory-name-query-preview"
              name="member-directory-name-query-preview"
              type="text"
              value=""
              disabled
              readOnly
              autoComplete="off"
              aria-labelledby="member-directory-query-label-preview"
              aria-describedby="member-directory-search-preview-status member-directory-query-help-preview"
              className="member-directory-admin__input mt-3 block min-h-11 min-w-0 w-full max-w-full rounded border border-gray-500 bg-white px-3 py-2 text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <button
            type="submit"
            disabled
            aria-describedby="member-directory-search-preview-status"
            className="member-directory-admin__button min-h-11 w-full rounded border-2 border-blue-800 bg-blue-800 px-5 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            Search
          </button>
        </div>
      </form>
    </>
  );
}

function ConnectedMemberDirectoryRoute() {
  const { services, isReady } = useServiceLocator();
  const { user } = useAuth();
  const app = isReady && services ? services.firebaseResources.app : null;
  const adminUid = user?.uid ?? null;

  if (!app || !adminUid) {
    return (
      <p
        className="mt-6 rounded border border-red-700 bg-red-50 p-3 text-sm text-red-900"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {SETUP_FAILURE}
      </p>
    );
  }

  return (
    <SearchAttempt
      key={`${appIdentity(app)}:${adminUid}`}
      app={app}
    />
  );
}

function MemberDirectoryRoute({ backendAvailable }: { backendAvailable: boolean }) {
  return backendAvailable
    ? <ConnectedMemberDirectoryRoute />
    : <MemberDirectoryPreview />;
}

function Inner({ backendAvailable }: { backendAvailable: boolean }) {
  const introduction = backendAvailable
    ? 'Search by the beginning of a person\'s current display name or any name part. Only website-account holders who turned on the optional officer finder can appear. A result does not prove current club membership, payment, eligibility, or a website role.'
    : 'When connected, search by the beginning of a person\'s current display name or any name part. Only website-account holders who turned on the optional officer finder can appear. A result does not prove current club membership, payment, eligibility, or a website role.';

  return (
    <>
      <SEO title="Admin — People finder" noindex />
      <div className="container mx-auto min-w-0 max-w-5xl overflow-x-hidden p-4 text-gray-900">
        <Link to="/admin" className="text-sm text-blue-700 underline hover:text-blue-900">
          ← Admin home
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">People finder</h1>
        <p className="mt-3 max-w-3xl text-gray-800">
          {introduction}
        </p>
        <p className="mt-2 max-w-3xl text-gray-800">
          Photos are voluntary. This page does not accept a photo as a query and does
          not use facial recognition, image matching, fuzzy matching, or a full account list.
        </p>
        <MemberDirectoryRoute backendAvailable={backendAvailable} />
      </div>
    </>
  );
}

export default function AdminMemberDirectory({
  backendAvailable = MEMBER_DIRECTORY_BACKEND_AVAILABLE,
}: {
  backendAvailable?: boolean;
}) {
  return (
    <AdminGuard>
      <Inner backendAvailable={backendAvailable} />
    </AdminGuard>
  );
}
