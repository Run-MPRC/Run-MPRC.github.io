import React, { useEffect, useState } from 'react';
import JoinUs from './JoinUs';
import Waiver from './Waiver';
import Header from '../../components/Header';
import HeaderImage from '../../images/joinus/header_bg_1.jpg';
import { JOIN_US_TITLE } from '../../text/JoinUs';

function JoinUsConditionalRoute() {
  const [hasSignedWaiver, setHasSignedWaiver] = useState(false);

  useEffect(() => {
    const waiverSigned = localStorage.getItem('waiverSigned');
    console.log(waiverSigned);
    setHasSignedWaiver(waiverSigned === 'true');
  }, []);

  const onWaiverSubmit = () => {
    window.scrollTo({
      top: 0,
    });
    setHasSignedWaiver(true);
  };

  return (
    <>
      <Header title={JOIN_US_TITLE} image={HeaderImage} />
      {hasSignedWaiver ? (
        <JoinUs />
      ) : (
        <Waiver onWaiverSubmit={onWaiverSubmit} />
      )}
    </>
  );
}

export default JoinUsConditionalRoute;
