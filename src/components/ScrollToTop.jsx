import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

function ScrollToTop() {
  const { pathname } = useLocation();
  const previousPathnameRef = useRef(pathname);
  const focusIntentRef = useRef(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  useLayoutEffect(() => {
    if (previousPathnameRef.current === pathname) return undefined;
    previousPathnameRef.current = pathname;

    const intent = {
      frameId: null,
      main: document.getElementById('main-content'),
      origin: document.activeElement,
    };
    focusIntentRef.current = intent;

    return () => {
      if (focusIntentRef.current === intent) focusIntentRef.current = null;
      if (intent.frameId !== null) {
        window.cancelAnimationFrame(intent.frameId);
        intent.frameId = null;
      }
    };
  }, [pathname]);

  useEffect(() => {
    const intent = focusIntentRef.current;
    if (intent === null) return undefined;

    intent.frameId = window.requestAnimationFrame(() => {
      if (focusIntentRef.current !== intent) return;

      focusIntentRef.current = null;
      intent.frameId = null;

      const { main, origin } = intent;
      if (
        !(main instanceof HTMLElement)
        || !main.isConnected
        || document.getElementById('main-content') !== main
      ) return;

      const active = document.activeElement;
      if (active === main || (active instanceof Node && main.contains(active))) return;

      const hasNewConnectedFocus = active instanceof Element
        && active.isConnected
        && active !== document.body
        && active !== document.documentElement
        && active !== origin;
      if (hasNewConnectedFocus) return;

      main.focus({ preventScroll: true });
    });

    return () => {
      if (focusIntentRef.current === intent) focusIntentRef.current = null;
      if (intent.frameId !== null) {
        window.cancelAnimationFrame(intent.frameId);
        intent.frameId = null;
      }
    };
  }, [pathname]);

  return null;
}

export default ScrollToTop;
