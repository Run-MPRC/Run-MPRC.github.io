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
  const normalizedPathname = location.pathname === '/'
    ? '/'
    : location.pathname.toLowerCase().replace(/\/+$/, '');

  return CAPABILITY_CALLBACK_PATHS.has(normalizedPathname)
    && (location.search.length > 0 || location.hash.length > 0);
}
