import React, { useEffect, useState } from 'react';
import JoinUs from './JoinUs';
import Waiver from './Waiver';

const ConditionalRoute = () => {
    const [hasSignedWaiver, setHasSignedWaiver] = useState(false);

    useEffect(() => {
        const waiverSigned = localStorage.getItem('waiverSigned');
        setHasSignedWaiver(waiverSigned === 'true');
    }, []);

    const onWaiverSubmit = () => {
        setHasSignedWaiver(true);
    };

    if (hasSignedWaiver) {
        return <JoinUs />;
    } else {
        console.log("has not agreed to waiver")
        return <Waiver onWaiverSubmit={ onWaiverSubmit }/>;
    }
};

export default ConditionalRoute;