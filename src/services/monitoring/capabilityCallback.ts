type BrowserLocationState = {
  pathname: string;
  search: string;
  hash: string;
};

const CAPABILITY_CALLBACK_PATHS = new Set([
  '/account/strava/callback',
  '/register/success',
  '/shop/purchase/success',
]);

export default function hasCapabilityCallbackState(
  location: BrowserLocationState,
): boolean {
  let routerPathname: string;
  try {
    // Match React Router's segment decoding without turning an encoded slash
    // into a new path separator.
    routerPathname = location.pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment).replace(/\//g, '%2F'))
      .join('/');
  } catch {
    // A malformed encoded path cannot be compared reliably. If it also
    // carries query/fragment state, suppress telemetry rather than guess.
    return location.search.length > 0 || location.hash.length > 0;
  }

  const normalizedPathname = routerPathname === '/'
    ? '/'
    : routerPathname.toLowerCase().replace(/\/+$/, '');

  return CAPABILITY_CALLBACK_PATHS.has(normalizedPathname)
    && (location.search.length > 0 || location.hash.length > 0);
}
