import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import FlexColumnContainer from '../../components/FlexColumnContainer';
import './waiver.css';
import FirebaseResources from '../../services/firebase/FirebaseResources';
import { logEvent } from 'firebase/analytics';
import { WAIVER_TEXT, WAIVER_AGREEMENT } from '../../text/JoinUs';

function Waiver({ onWaiverSubmit }) {
  const [isAgreed, setIsAgreed] = useState(false);
  const navigate = useNavigate();
  const firebaseResources = new FirebaseResources();

  const handleCheckboxChange = (event) => {
    setIsAgreed(event.target.checked);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const analytics = firebaseResources.getAnalytics;
    logEvent(analytics, 'signed_waiver', {
      signed: isAgreed,
    });
    if (isAgreed) {
      localStorage.setItem('waiverSigned', 'true');
      onWaiverSubmit();
    } else {
      navigate('/');
    }
  };

  return (
    <FlexColumnContainer>
      <h1 className="waiver-title">Waiver</h1>
      <form className="waiver-form" onSubmit={handleSubmit}>
        <p className="waiver-text">{WAIVER_TEXT}</p>
        <label className="waiver-agree-checkbox">
          <input
            type="checkbox"
            checked={isAgreed}
            onChange={handleCheckboxChange}
          />
          <span className="waiver-agree-text">{WAIVER_AGREEMENT}</span>
        </label>
        <button type="submit" className="btn lg" disabled={!isAgreed}>
          Submit
        </button>
      </form>
    </FlexColumnContainer>
  );
}

export default Waiver;
