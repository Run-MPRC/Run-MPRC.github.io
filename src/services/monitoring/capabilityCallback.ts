type BrowserLocationState = {
  pathname: string;
  search: string;
  hash: string;
};

const CAPABILITY_CALLBACK_PATHS = new Set([
  '/account/strava/callback',
  '/auth/action',
  '/register/success',
  '/shop/purchase/success',
]);

const STRAVA_CALLBACK_PATH = '/account/strava/callback';

function normalizeCapabilityCallbackPath(pathname: string): string | null {
  let routerPathname: string;
  try {
    // Match React Router's segment decoding without turning an encoded slash
    // into a new path separator.
    routerPathname = pathname
      .split('/')
      .map((segment) => decodeURIComponent(segment).replace(/\//g, '%2F'))
      .join('/');
  } catch {
    return null;
  }

  return routerPathname === '/'
    ? '/'
    : routerPathname.toLowerCase().replace(/\/+$/, '');
}

export function isStravaCapabilityCallbackPath(pathname: string): boolean {
  return normalizeCapabilityCallbackPath(pathname) === STRAVA_CALLBACK_PATH;
}

export function isCapabilityCallbackPath(pathname: string): boolean {
  const normalizedPathname = normalizeCapabilityCallbackPath(pathname);
  return normalizedPathname !== null && CAPABILITY_CALLBACK_PATHS.has(normalizedPathname);
}

export function browserRouterStateIsClean(
  historyState: unknown,
  expectedKey?: string,
): boolean {
  if (historyState === null) {
    return expectedKey === undefined || expectedKey === 'default';
  }
  if (typeof historyState !== 'object') return false;

  try {
    if (Object.getPrototypeOf(historyState) !== Object.prototype) return false;
    const ownKeys = Reflect.ownKeys(historyState);
    if (
      ownKeys.length !== 3
      || !['idx', 'key', 'usr'].every((key) => ownKeys.includes(key))
    ) return false;

    const indexState = Object.getOwnPropertyDescriptor(historyState, 'idx');
    const keyState = Object.getOwnPropertyDescriptor(historyState, 'key');
    const userState = Object.getOwnPropertyDescriptor(historyState, 'usr');
    if (
      indexState === undefined
      || keyState === undefined
      || userState === undefined
      || !Object.prototype.hasOwnProperty.call(indexState, 'value')
      || !Object.prototype.hasOwnProperty.call(keyState, 'value')
      || !Object.prototype.hasOwnProperty.call(userState, 'value')
    ) return false;

    // The pinned Router takes at most eight lowercase base-36 characters
    // from Math.random(). Short or empty outputs are possible.
    const keyIsValid = typeof keyState.value === 'string'
      && /^[a-z0-9]{0,8}$/.test(keyState.value);
    const keyMatchesRouter = expectedKey === undefined
      || keyState.value === expectedKey
      || (keyState.value === '' && expectedKey === 'default');
    return Number.isSafeInteger(indexState.value)
      && indexState.value >= 0
      && keyIsValid
      && keyMatchesRouter
      && userState.value === null;
  } catch {
    return false;
  }
}

export default function hasCapabilityCallbackState(
  location: BrowserLocationState,
): boolean {
  const normalizedPathname = normalizeCapabilityCallbackPath(location.pathname);
  if (normalizedPathname === null) {
    // A malformed encoded path cannot be compared reliably. If it also
    // carries query/fragment state, suppress telemetry rather than guess.
    return location.search.length > 0 || location.hash.length > 0;
  }

  return CAPABILITY_CALLBACK_PATHS.has(normalizedPathname)
    && (location.search.length > 0 || location.hash.length > 0);
}
