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
  return CAPABILITY_CALLBACK_PATHS.has(location.pathname)
    && (location.search.length > 0 || location.hash.length > 0);
}
