import React, { useEffect, useState } from 'react';
import JoinUs from './JoinUs';
import Waiver from './Waiver';

function JoinUsConditionalRoute() {
  const [hasSignedWaiver, setHasSignedWaiver] = useState(false);

  useEffect(() => {
    // localStorage.setItem('waiverSigned', 'false');
    const waiverSigned = localStorage.getItem('waiverSigned');
    console.log(waiverSigned);
    setHasSignedWaiver(waiverSigned === 'true');
  }, []);

  const onWaiverSubmit = () => {
    setHasSignedWaiver(true);
  };

  if (hasSignedWaiver) {
    console.log("has agreed to waiver")
    return <JoinUs />;
  } else {
    console.log("has not agreed to waiver")
    return <Waiver onWaiverSubmit={ onWaiverSubmit }/>;
  }
}

export default JoinUsConditionalRoute;