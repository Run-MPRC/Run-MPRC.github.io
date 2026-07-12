const DEFAULT_RETURN_PATH = '/account';

interface RouterLocation {
  pathname: string;
  search: string;
  hash: string;
}

export function getLocationReturnPath(location: RouterLocation): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint < 0x20 || codePoint === 0x7F;
  });
}

function hasSingleLeadingSlash(pathname: string): boolean {
  return pathname.startsWith('/') && !pathname.startsWith('//');
}

export function getSafeLoginReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !hasSingleLeadingSlash(value)) {
    return DEFAULT_RETURN_PATH;
  }

  try {
    const decodedValue = decodeURIComponent(value);
    if (
      !hasSingleLeadingSlash(decodedValue)
      || decodedValue.includes('\\')
      || hasControlCharacter(decodedValue)
    ) {
      return DEFAULT_RETURN_PATH;
    }

    const { origin } = window.location;
    const returnUrl = new URL(value, origin);
    const decodedUrl = new URL(decodedValue, origin);
    if (
      returnUrl.origin !== origin
      || decodedUrl.origin !== origin
      || !hasSingleLeadingSlash(returnUrl.pathname)
      || !hasSingleLeadingSlash(decodedUrl.pathname)
    ) {
      return DEFAULT_RETURN_PATH;
    }

    return `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
  } catch {
    return DEFAULT_RETURN_PATH;
  }
}
