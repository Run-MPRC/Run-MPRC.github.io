import React from 'react';
import './home.css';
import MainHeader from '../../components/MainHeader';
import About from '../about/About';
import SEO from '../../components/SEO';

function Home() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Mid-Peninsula Running Club Home",
    "description": "Join the Mid-Peninsula Running Club in San Mateo, CA! Weekly Saturday runs on the Bay Trail, social events, and a supportive community of Bay Area runners since 1988.",
    "url": "https://run-mprc.github.io/",
    "mainEntity": {
      "@type": "SportsOrganization",
      "name": "Mid-Peninsula Running Club",
      "alternateName": "MPRC",
      "description": "A running club serving the San Francisco Peninsula since 1988, offering weekly runs, social events, and a supportive community for Bay Area runners.",
      "foundingDate": "1988",
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "San Mateo",
        "addressRegion": "CA",
        "addressCountry": "US"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": 37.5629,
        "longitude": -122.3255
      },
      "areaServed": {
        "@type": "Place",
        "name": "San Francisco Peninsula",
        "description": "San Mateo County and surrounding Bay Area cities"
      },
      "sport": "Running",
      "event": {
        "@type": "SportsEvent",
        "name": "Saturday Morning Run",
        "description": "Weekly group run on the Bay Trail",
        "startDate": "2024-01-01T09:00:00-08:00",
        "endDate": "2024-12-31T10:00:00-08:00",
        "location": {
          "@type": "Place",
          "name": "Seal Point Park",
          "address": {
            "@type": "PostalAddress",
            "streetAddress": "1901 J Hart Clinton Dr",
            "addressLocality": "San Mateo",
            "addressRegion": "CA",
            "postalCode": "94401",
            "addressCountry": "US"
          }
        },
        "organizer": {
          "@type": "Organization",
          "name": "Mid-Peninsula Running Club"
        }
      }
    }
  };

  return (
    <>
      <SEO 
        title="Bay Area Running Club in San Mateo"
        description="Join the Mid-Peninsula Running Club in San Mateo, CA! Weekly Saturday runs on the Bay Trail, social events, and a supportive community of Bay Area runners since 1988. Free to run with us!"
        keywords="running club, Bay Area running, San Mateo running club, Peninsula running, Bay Trail running, Saturday running group, MPRC, Mid-Peninsula Running Club, California running club, San Francisco Peninsula running, Seal Point Park running"
        url="https://run-mprc.github.io/"
        structuredData={structuredData}
      />
      <MainHeader />
      <About />
    </>
  );
}

export default Home;
