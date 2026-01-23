import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { logEvent } from 'firebase/analytics';
import FlexColumnContainer from '../../components/FlexColumnContainer';
import './waiver.css';
import { useServiceLocator } from '../../services/ServiceLocatorContext';
import { WAIVER_FORM_LINK } from '../../text/externalLinks';

const WAIVER_INTRO = 'Please read and complete the waiver form below before joining our runs.';
const WAIVER_TITLE = 'Club Activity Waiver';

function Waiver({ onWaiverSubmit }) {
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const { services } = useServiceLocator();

  const handleFormSubmit = () => {
    const { analytics } = services?.firebaseResources || {};
    if (analytics) {
      logEvent(analytics, 'signed_waiver', {
        signed: true,
      });
    }
    localStorage.setItem('waiverSigned', 'true');
    setHasSubmitted(true);
  };

  const handleContinue = () => {
    onWaiverSubmit();
  };

  return (
    <FlexColumnContainer>
      <h2 className="waiver-title">{WAIVER_TITLE}</h2>
      <p className="waiver-intro">{WAIVER_INTRO}</p>

      <div className="waiver-form-container">
        <iframe
          src={WAIVER_FORM_LINK}
          title="MPRC Waiver Form"
          className="waiver-iframe"
          frameBorder="0"
          marginHeight="0"
          marginWidth="0"
        >
          Loading form...
        </iframe>
      </div>

      <div className="waiver-actions">
        <p className="waiver-instruction">
          After submitting the form above, click the button below to continue.
        </p>
        <button
          type="button"
          className="btn lg"
          onClick={handleFormSubmit}
          disabled={hasSubmitted}
        >
          {hasSubmitted ? 'Form Acknowledged' : 'I Have Submitted the Waiver'}
        </button>

        {hasSubmitted && (
          <button
            type="button"
            className="btn lg primary"
            onClick={handleContinue}
            style={{ marginTop: '1rem' }}
          >
            Continue to Join Us Page
          </button>
        )}
      </div>
    </FlexColumnContainer>
  );
}

Waiver.propTypes = {
  onWaiverSubmit: PropTypes.func.isRequired,
};

Waiver.defaultProps = {};

export default Waiver;
