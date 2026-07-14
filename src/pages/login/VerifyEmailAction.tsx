import React, {
  useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Header from '../../components/Header';
import SEO from '../../components/SEO';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import {
  isValidEmailActionCode,
} from '../../services/identity/Identity';
import type {
  EmailVerificationActionResult,
} from '../../services/identity/Identity';
import './VerifyEmailAction.css';

type ViewState =
  | 'ready'
  | 'checking'
  | EmailVerificationActionResult;

function readVerificationCode(search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    const modes = params.getAll('mode');
    const codes = params.getAll('oobCode');
    if (
      modes.length !== 1
      || modes[0] !== 'verifyEmail'
      || codes.length !== 1
      || !isValidEmailActionCode(codes[0])
    ) {
      return null;
    }
    return codes[0];
  } catch {
    return null;
  }
}

function resultCopy(state: Exclude<ViewState, 'ready' | 'checking' | 'unavailable'>) {
  switch (state) {
    case 'verified':
      return {
        message: 'Email verified.',
        detail: 'This confirms control of the email address. It does not grant club membership, paid status, discounts, or officer access.',
      };
    case 'already-complete':
      return {
        message: 'Email verification is already complete.',
        detail: 'No account or membership setting was changed by this page.',
      };
    case 'wrong-account':
      return {
        message: 'A different account is signed in.',
        detail: 'Open My Account, sign out, then reopen the original private email link. Do not copy or share the link.',
      };
    default:
      return {
        message: 'This verification link cannot be used.',
        detail: 'It may already be complete, expired, malformed, or for an unsupported action. Continue to My Account and request one new verification email if needed.',
      };
  }
}

function VerifyEmailAction() {
  const location = useLocation();
  const navigate = useNavigate();
  const { services, isReady } = useServiceLocator();
  const actionCodeRef = useRef<string | null | undefined>(undefined);
  if (actionCodeRef.current === undefined) {
    actionCodeRef.current = readVerificationCode(location.search);
  }
  const [viewState, setViewState] = useState<ViewState>(
    actionCodeRef.current === null ? 'unusable' : 'ready',
  );
  const [historyScrubbed, setHistoryScrubbed] = useState(false);
  const inFlightRef = useRef(false);
  const initialScrubCompleteRef = useRef(false);
  const mountedRef = useRef(true);
  const requestVersionRef = useRef(0);
  const scrubFailedRef = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const hasNavigationState = location.search !== ''
      || location.hash !== ''
      || location.state !== null;
    if (!hasNavigationState) {
      if (scrubFailedRef.current) return;
      initialScrubCompleteRef.current = true;
      setHistoryScrubbed(true);
      return;
    }

    setHistoryScrubbed(false);
    if (initialScrubCompleteRef.current) {
      requestVersionRef.current += 1;
      actionCodeRef.current = null;
      setViewState('unusable');
    }

    try {
      // Remove the visible capability before paint. React Router's parent
      // listener is synchronized in the following effect before any action is
      // enabled.
      window.history.replaceState(null, document.title, location.pathname);
    } catch {
      scrubFailedRef.current = true;
      requestVersionRef.current += 1;
      actionCodeRef.current = null;
      setViewState('unusable');
      setHistoryScrubbed(false);
    }
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
  ]);

  useEffect(() => {
    const hasNavigationState = location.search !== ''
      || location.hash !== ''
      || location.state !== null;
    if (!hasNavigationState || scrubFailedRef.current) return;

    try {
      // Once BrowserRouter is listening, replace its location too. The action
      // remains disabled until a clean router location renders.
      navigate({
        pathname: location.pathname,
        search: '',
        hash: '',
      }, { replace: true, state: null });
    } catch {
      scrubFailedRef.current = true;
      requestVersionRef.current += 1;
      actionCodeRef.current = null;
      setViewState('unusable');
      setHistoryScrubbed(false);
    }
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!['ready', 'checking'].includes(viewState)) {
      resultRef.current?.focus();
    }
  }, [viewState]);

  const runVerification = async () => {
    const actionCode = actionCodeRef.current;
    if (
      inFlightRef.current
      || !historyScrubbed
      || !isReady
      || !services
      || actionCode === null
      || actionCode === undefined
    ) {
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setViewState('unavailable');
      return;
    }

    inFlightRef.current = true;
    const requestVersion = requestVersionRef.current;
    setViewState('checking');
    let result: EmailVerificationActionResult;
    try {
      result = await services.identityService.verifyEmailAction(actionCode);
    } catch {
      result = 'unavailable';
    } finally {
      inFlightRef.current = false;
    }
    if (mountedRef.current && requestVersion === requestVersionRef.current) {
      if (result !== 'unavailable') actionCodeRef.current = null;
      setViewState(result);
    }
  };

  const providerReady = historyScrubbed && isReady && services !== null;
  const preparing = viewState === 'ready' && !providerReady;
  const checking = viewState === 'checking';
  const showAction = viewState === 'ready' || viewState === 'unavailable';
  let actionLabel = 'Verify email';
  if (checking) actionLabel = 'Checking verification...';
  else if (viewState === 'unavailable') actionLabel = 'Try verification again';
  else if (preparing) actionLabel = 'Preparing verification...';
  const terminalCopy = !['ready', 'checking', 'unavailable'].includes(viewState)
    ? resultCopy(viewState as Exclude<
      ViewState,
      'ready' | 'checking' | 'unavailable'
    >)
    : null;

  return (
    <>
      <SEO title="Verify Email" noindex />
      <Header title="Verify your email" image="/logo512.png">
        Check one private verification link safely.
      </Header>
      <div className="container mx-auto px-4 py-10 flex justify-center">
        <section className="verify-email-panel" aria-labelledby="verify-email-title">
          <h1 id="verify-email-title" className="text-xl font-semibold">
            Email verification
          </h1>

          {viewState === 'ready' && (
            <p>
              Choose Verify email to check this private link. Opening this page alone
              does not change an account.
            </p>
          )}

          {checking && (
            <div role="status" aria-live="polite" aria-atomic="true">
              Checking the verification link...
            </div>
          )}

          {viewState === 'unavailable' && (
            <div
              ref={resultRef}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              tabIndex={-1}
              className="verify-email-result"
            >
              <p className="verify-email-result__title">
                Verification is temporarily unavailable.
              </p>
              <p>
                Check your connection, then try once more. This page cannot confirm
                whether the email is verified yet.
              </p>
            </div>
          )}

          {!['ready', 'checking', 'unavailable'].includes(viewState) && (
            <div
              ref={resultRef}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              tabIndex={-1}
              className="verify-email-result"
            >
              <p className="verify-email-result__title">
                {terminalCopy?.message}
              </p>
              <p>
                {terminalCopy?.detail}
              </p>
              {/* Start a clean App Check session after capability suppression. */}
              <a href="/account" className="verify-email-link">
                Continue to My Account
              </a>
            </div>
          )}

          {(showAction || checking) && (
            <button
              type="button"
              onClick={runVerification}
              disabled={!providerReady || checking}
              aria-busy={checking}
              className="verify-email-action"
            >
              {actionLabel}
            </button>
          )}

          <p className="verify-email-safety-note">
            Never share a verification link or code with an officer, support person,
            screenshot, issue, email, or AI tool.
          </p>
        </section>
      </div>
    </>
  );
}

export default VerifyEmailAction;
