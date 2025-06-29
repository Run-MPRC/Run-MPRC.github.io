import React from 'react';
import { Helmet } from 'react-helmet-async';
import PropTypes from 'prop-types';

const SEO = ({
  title,
  description,
  keywords,
  image,
  url,
  type = 'website',
  structuredData,
  canonicalUrl,
}) => {
  const fullTitle = title 
    ? `${title} - Mid-Peninsula Running Club | Bay Area Running Club`
    : 'Mid-Peninsula Running Club - Bay Area Running Club in San Mateo | MPRC';
  
  const defaultDescription = 'Join the Mid-Peninsula Running Club in San Mateo, CA! Weekly Saturday runs on the Bay Trail, social events, and a supportive community of Bay Area runners since 1988.';
  const defaultKeywords = 'running club, Bay Area running, San Mateo running club, Peninsula running, Bay Trail running, Saturday running group, MPRC, Mid-Peninsula Running Club, California running club, San Francisco Peninsula running';
  const defaultImage = 'https://run-mprc.github.io/logo512.png';
  const defaultUrl = 'https://run-mprc.github.io/';

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={description || defaultDescription} />
      <meta name="keywords" content={keywords || defaultKeywords} />
      
      {/* Canonical URL */}
      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
      
      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url || defaultUrl} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description || defaultDescription} />
      <meta property="og:image" content={image || defaultImage} />
      <meta property="og:site_name" content="Mid-Peninsula Running Club" />
      <meta property="og:locale" content="en_US" />
      
      {/* Twitter */}
      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={url || defaultUrl} />
      <meta property="twitter:title" content={fullTitle} />
      <meta property="twitter:description" content={description || defaultDescription} />
      <meta property="twitter:image" content={image || defaultImage} />
      
      {/* Structured Data */}
      {structuredData && (
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      )}
    </Helmet>
  );
};

SEO.propTypes = {
  title: PropTypes.string,
  description: PropTypes.string,
  keywords: PropTypes.string,
  image: PropTypes.string,
  url: PropTypes.string,
  type: PropTypes.string,
  structuredData: PropTypes.object,
  canonicalUrl: PropTypes.string,
};

export default SEO; 