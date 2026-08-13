import React from 'react';
import { Link } from 'react-router-dom';
import SEO from '../../components/SEO';
import './suggestions.css';

const DESCRIPTION = 'Share a short idea with Mid-Peninsula Running Club through our existing Contact page. This Suggestions page has no form or new data store.';

function Suggestions() {
  return (
    <>
      <SEO
        title="Share a Suggestion"
        description={DESCRIPTION}
        url="https://runmprc.com/suggestions"
        canonicalUrl="https://runmprc.com/suggestions"
      />
      <section className="suggestions" aria-labelledby="suggestions-title">
        <div className="container suggestions__container">
          <p className="suggestions__eyebrow">Help improve the club</p>
          <h1 id="suggestions-title">Suggestions</h1>
          <p className="suggestions__intro">
            We welcome short ideas about club runs, events, communications,
            accessibility, and the website.
          </p>

          <div className="suggestions__notice">
            <h2>Share an idea through Contact</h2>
            <p>
              This page does not submit or store your suggestion. It has no
              suggestion form or suggestion-specific tracking. Open Contact and
              choose its email link if you want to send an idea.
            </p>
            <p>
              If you send an email, your email service and the club&apos;s existing
              email service may retain your address and message. The Contact email
              is not anonymous or confidential.
            </p>
          </div>

          <div className="suggestions__safety">
            <h2>Keep private information out</h2>
            <p>
              Do not include passwords or verification codes, payment details,
              private member information, health information, emergency-contact
              details, or vulnerability evidence.
            </p>
            <p>
              For a security or privacy problem, use Contact and write
              {' '}
              <strong>security report</strong>
              . Ask for a secure reply. Keep secrets, private records, payment
              references, and exploit details out of an ordinary suggestion.
            </p>
          </div>

          <p className="suggestions__expectation">
            We may not reply, and sending an idea does not promise that it will be
            implemented.
          </p>

          <Link className="suggestions__contact-link" to="/contact">
            Go to Contact
          </Link>
        </div>
      </section>
    </>
  );
}

export default Suggestions;
