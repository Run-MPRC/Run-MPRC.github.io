import React from 'react';
import './contact.css';
import { MdEmail } from 'react-icons/md';
import { FaInstagram, FaStrava } from 'react-icons/fa';
import SEO from '../../components/SEO';
import Header from '../../components/Header';
import HeaderImage from '../../images/contact/header_bg_2.jpg';
import ObfuscatedEmail from '../../components/ObfuscatedEmail';
import { CONTACT_TITLE } from '../../text/ContactUs';
import { INSTAGRAM_URI, STRAVA_URI } from '../../text/externalLinks';

// Email parts split to prevent bot scraping
const EMAIL_USER = 'runmprc';
const EMAIL_DOMAIN = 'gmail';
const EMAIL_TLD = 'com';

function Contact() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Contact Mid-Peninsula Running Club',
    description: 'Contact the Mid-Peninsula Running Club in San Mateo, CA. Get in touch with our Bay Area running community for questions about joining, events, or running with us.',
    url: 'https://runmprc.com/contact',
    mainEntity: {
      '@type': 'Organization',
      name: 'Mid-Peninsula Running Club',
      sameAs: [STRAVA_URI, INSTAGRAM_URI],
      // Email omitted from structured data to prevent scraping
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer service',
        availableLanguage: 'English',
      },
    },
  };

  return (
    <>
      <SEO
        title="Contact Our Bay Area Running Club"
        description="Contact the Mid-Peninsula Running Club in San Mateo, CA. Get in touch with our Bay Area running community for questions about joining, events, or running with us."
        keywords="contact MPRC, Mid-Peninsula Running Club contact, Bay Area running club, San Mateo running club contact, running club questions"
        url="https://runmprc.com/contact"
        canonicalUrl="https://runmprc.com/contact"
        structuredData={structuredData}
      />
      <Header title={CONTACT_TITLE} image={HeaderImage} />

      <section className="contact">
        <div className="container contact__container">
          <p className="contact__description">
            Have questions? Interested in joining? Exciting running stories to share?
            Reach out to us and we are ready to welcome you into the world of running.
            Let&apos;s run together!
          </p>
          <div className="contact__wrapper">
            <ObfuscatedEmail
              user={EMAIL_USER}
              domain={EMAIL_DOMAIN}
              tld={EMAIL_TLD}
              className="contact__email-link"
            >
              <MdEmail />
            </ObfuscatedEmail>
            <a
              href={STRAVA_URI}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="MPRC on Strava (opens in a new tab)"
              title="MPRC on Strava"
            >
              <FaStrava />
            </a>
            <a
              href={INSTAGRAM_URI}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="MPRC on Instagram (opens in a new tab)"
              title="MPRC on Instagram"
            >
              <FaInstagram />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

export default Contact;
