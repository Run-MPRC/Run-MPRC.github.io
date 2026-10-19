import React, { useEffect, useRef, useState } from 'react';
import './zeffyMembershipForm.css';

const FORM_PATH = '/embed/ticketing/mid-peninsula-running-clubs-membership';
const FORM_URL = `https://www.zeffy.com${FORM_PATH}`;
const MEMBERSHIP_URL = 'https://www.zeffy.com/en-US/ticketing/mid-peninsula-running-clubs-membership';

function ZeffyMembershipForm() {
  const embedRef = useRef(null);
  const scriptRef = useRef(null);
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    const embed = embedRef.current;
    const script = document.createElement('script');
    script.src = 'https://www.zeffy.com/embed/v2/zeffy-embed.js';
    script.async = true;
    script.onerror = () => setUseFallback(true);
    scriptRef.current.appendChild(script);

    return () => {
      script.onerror = null;
      script.remove();
      // Zeffy owns the children it adds here. A route remount starts fresh.
      embed.replaceChildren();
    };
  }, []);

  return (
    <div id="membership-signup" className="zeffy-membership" role="region" aria-label="MPRC membership signup">
      {process.env.REACT_APP_FIREBASE_ENVIRONMENT === 'staging' && (
        <p className="zeffy-membership__notice">
          <strong>Staging preview:</strong>
          {' '}
          This is the club&apos;s real Zeffy form. View only; do not submit details or pay.
        </p>
      )}
      <p>
        Join or renew through Zeffy. No MPRC account is needed.
        Membership options, prices and opening dates are shown in the form.
      </p>
      <p>
        <a className="hyperlink" href={MEMBERSHIP_URL} target="_blank" rel="noopener noreferrer">
          Open the membership form in a new tab
        </a>
      </p>
      <div ref={embedRef} data-zeffy-embed="" data-form-url={FORM_PATH} hidden={useFallback} />
      <div data-zeffy-embed-fallback="" style={{ display: useFallback ? 'block' : 'none' }}>
        <div className="zeffy-membership__frame">
          <iframe
            title="MPRC membership form powered by Zeffy"
            data-zeffy-embed-src={FORM_URL}
            src={useFallback ? FORM_URL : undefined}
            allow="payment"
          />
        </div>
      </div>
      <div ref={scriptRef} />
    </div>
  );
}

export default ZeffyMembershipForm;
