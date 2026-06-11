import { ComponentType } from 'react';

export interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: string;
  structuredData?: Record<string, unknown>;
  canonicalUrl?: string;
  noindex?: boolean;
}

declare const SEO: ComponentType<SEOProps>;
export default SEO;
