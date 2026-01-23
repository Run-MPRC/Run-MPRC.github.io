// Base organization info used across all pages
export const ORGANIZATION_INFO = {
  name: 'Mid-Peninsula Running Club',
  shortName: 'MPRC',
  description: 'A running club serving the San Francisco Peninsula since 1988',
  url: 'https://run-mprc.github.io',
  address: {
    streetAddress: '1901 J Hart Clinton Dr',
    addressLocality: 'San Mateo',
    addressRegion: 'CA',
    postalCode: '94401',
    addressCountry: 'US',
  },
  geo: {
    latitude: 37.5629,
    longitude: -122.3255,
  },
};

export interface StructuredDataOptions {
  pageTitle: string;
  pageDescription: string;
  pageUrl: string;
  pageType?: 'WebPage' | 'AboutPage' | 'ContactPage' | 'FAQPage';
}

export function createOrganizationSchema() {
  return {
    '@type': 'Organization',
    name: ORGANIZATION_INFO.name,
    description: ORGANIZATION_INFO.description,
    url: ORGANIZATION_INFO.url,
    address: {
      '@type': 'PostalAddress',
      ...ORGANIZATION_INFO.address,
    },
    geo: {
      '@type': 'GeoCoordinates',
      ...ORGANIZATION_INFO.geo,
    },
  };
}

export function createSportsOrganizationSchema() {
  return {
    '@type': 'SportsOrganization',
    name: ORGANIZATION_INFO.name,
    description: ORGANIZATION_INFO.description,
    address: {
      '@type': 'PostalAddress',
      ...ORGANIZATION_INFO.address,
    },
    geo: {
      '@type': 'GeoCoordinates',
      ...ORGANIZATION_INFO.geo,
    },
  };
}

export function createSaturdayRunEventSchema() {
  return {
    '@type': 'SportsEvent',
    name: 'Saturday Morning Run',
    description: 'Weekly group run at Seal Point Park',
    location: {
      '@type': 'Place',
      name: 'Seal Point Park',
      address: {
        '@type': 'PostalAddress',
        ...ORGANIZATION_INFO.address,
      },
    },
    startTime: '09:00',
    dayOfWeek: 'Saturday',
    organizer: {
      '@type': 'Organization',
      name: ORGANIZATION_INFO.name,
    },
  };
}

export function createPageSchema(options: StructuredDataOptions) {
  const { pageTitle, pageDescription, pageUrl, pageType = 'WebPage' } = options;

  return {
    '@context': 'https://schema.org',
    '@type': pageType,
    name: pageTitle,
    description: pageDescription,
    url: pageUrl,
    mainEntity: createOrganizationSchema(),
  };
}

export function createContactPageSchema(options: StructuredDataOptions) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: options.pageTitle,
    description: options.pageDescription,
    url: options.pageUrl,
    mainEntity: {
      ...createOrganizationSchema(),
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer service',
        areaServed: 'San Francisco Bay Area',
        availableLanguage: 'English',
      },
    },
  };
}

export function createJoinUsPageSchema(options: StructuredDataOptions) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: options.pageTitle,
    description: options.pageDescription,
    url: options.pageUrl,
    mainEntity: {
      ...createSportsOrganizationSchema(),
      event: createSaturdayRunEventSchema(),
      offers: {
        '@type': 'Offer',
        price: '25',
        priceCurrency: 'USD',
        description: 'Annual membership fee for individuals (2026)',
      },
    },
  };
}
