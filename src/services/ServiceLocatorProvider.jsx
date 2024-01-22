import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import FirebaseResources from './firebase/FirebaseResources.ts';
import ServiceLocatorContext from './ServiceLocatorContext';
import IdentityService from './identity/Identity.ts';

function ServiceLocatorProvider({ children }) {
  const [services, setServices] = useState({});

  useEffect(() => {
    const firebaseResources = new FirebaseResources();
    const identityService = new IdentityService(firebaseResources);
    setServices({
      firebaseResources,
      identityService,
    });
  }, []);

  return (
    <ServiceLocatorContext.Provider value={services}>
      {children}
    </ServiceLocatorContext.Provider>
  );
}

ServiceLocatorProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export default ServiceLocatorProvider;
