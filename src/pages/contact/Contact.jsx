import React from 'react';
import './contact.css';
import { MdEmail } from 'react-icons/md';
import SEO from '../../components/SEO';
import Header from '../../components/Header';
import HeaderImage from '../../images/contact/header_bg_2.jpg';
import { CONTACT_DESCRIPTION, CONTACT_TITLE } from '../../text/ContactUs';

function Contact() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Contact Mid-Peninsula Running Club",
    "description": "Contact the Mid-Peninsula Running Club in San Mateo, CA. Get in touch with our Bay Area running community for questions about joining, events, or running with us.",
    "url": "https://run-mprc.github.io/contact",
    "mainEntity": {
      "@type": "Organization",
      "name": "Mid-Peninsula Running Club",
      "email": "runmprc@gmail.com",
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "customer service",
        "email": "runmprc@gmail.com",
        "availableLanguage": "English"
      }
    }
  };

  return (
    <>
      <SEO 
        title="Contact Our Bay Area Running Club"
        description="Contact the Mid-Peninsula Running Club in San Mateo, CA. Get in touch with our Bay Area running community for questions about joining, events, or running with us."
        keywords="contact MPRC, Mid-Peninsula Running Club contact, Bay Area running club email, San Mateo running club contact, running club questions, MPRC email"
        url="https://run-mprc.github.io/contact"
        canonicalUrl="https://run-mprc.github.io/contact"
        structuredData={structuredData}
      />
      <Header title={CONTACT_TITLE} image={HeaderImage} />

      <section className="contact">
        <div className="container contact__container">
          {CONTACT_DESCRIPTION}
          <div className="contact__wrapper">
            <a
              href="mailto:runmprc@gmail.com"
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Send an email to runmprc@gmail.com"
            >
              <MdEmail />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

export default Contact;
