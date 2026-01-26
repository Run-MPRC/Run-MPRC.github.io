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
  const [hasConfirmed, setHasConfirmed] = useState(false);
  const { services } = useServiceLocator();

  const handleContinue = () => {
    const { analytics } = services?.firebaseResources || {};
    if (analytics) {
      logEvent(analytics, 'signed_waiver', {
        signed: true,
      });
    }
    localStorage.setItem('waiverSigned', 'true');
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
        <label className="waiver-checkbox-label">
          <input
            type="checkbox"
            checked={hasConfirmed}
            onChange={(e) => setHasConfirmed(e.target.checked)}
            className="waiver-checkbox"
          />
          I have submitted the waiver form above
        </label>
        <button
          type="button"
          className="btn lg primary"
          onClick={handleContinue}
          disabled={!hasConfirmed}
        >
          Continue to Join Us Page
        </button>
      </div>
    </FlexColumnContainer>
  );
}

Waiver.propTypes = {
  onWaiverSubmit: PropTypes.func.isRequired,
};

Waiver.defaultProps = {};

export default Waiver;
