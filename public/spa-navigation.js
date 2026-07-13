((root, factory) => {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (!root) return;

  const script = root.document && root.document.currentScript;
  const action = script && script.getAttribute('data-mprc-spa-action');

  if (action === 'capture') {
    api.captureRedirect(root);
  } else if (action === 'restore') {
    api.restoreRedirect(root);
  }
})(typeof window === 'undefined' ? null : window, () => {
  const STORAGE_KEY = 'mprc:spa-redirect';

  function buildRedirectTarget(location) {
    const pathname = typeof location.pathname === 'string'
      && location.pathname.startsWith('/')
      ? location.pathname
      : '/';
    const search = typeof location.search === 'string'
      && (location.search === '' || location.search.startsWith('?'))
      ? location.search
      : '';
    const hash = typeof location.hash === 'string'
      && (location.hash === '' || location.hash.startsWith('#'))
      ? location.hash
      : '';
    return pathname + search + hash;
  }

  function parseSameOriginTarget(storedTarget, origin) {
    if (typeof storedTarget !== 'string' || !storedTarget.startsWith('/')) {
      return null;
    }

    try {
      const normalizedOrigin = new URL(origin).origin;
      const target = new URL(storedTarget, normalizedOrigin);
      if (target.origin !== normalizedOrigin) return null;
      if (!target.pathname.startsWith('/') || target.pathname.startsWith('//')) {
        return null;
      }
      return target.pathname + target.search + target.hash;
    } catch (_error) {
      return null;
    }
  }

  function captureRedirect(browserWindow) {
    const target = buildRedirectTarget(browserWindow.location);
    try {
      browserWindow.sessionStorage.setItem(STORAGE_KEY, target);
    } catch (_error) {
      browserWindow.location.replace('/');
      return false;
    }
    browserWindow.location.replace('/');
    return true;
  }

  function restoreRedirect(browserWindow) {
    let storedTarget;
    try {
      storedTarget = browserWindow.sessionStorage.getItem(STORAGE_KEY);
      browserWindow.sessionStorage.removeItem(STORAGE_KEY);
    } catch (_error) {
      return false;
    }
    if (!storedTarget) return false;

    const target = parseSameOriginTarget(
      storedTarget,
      browserWindow.location.origin,
    );
    if (!target) return false;

    try {
      browserWindow.history.replaceState(null, '', target);
      return true;
    } catch (_error) {
      return false;
    }
  }

  return {
    STORAGE_KEY,
    buildRedirectTarget,
    parseSameOriginTarget,
    captureRedirect,
    restoreRedirect,
  };
});
