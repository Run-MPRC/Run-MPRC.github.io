import React, { useEffect, useState, useMemo, ReactNode } from 'react';
import FirebaseResources from './firebase/FirebaseResources';
import ServiceLocatorContext, { Services, ServiceLocatorContextValue } from './ServiceLocatorContext';
import IdentityService from './identity/Identity';

interface ServiceLocatorProviderProps {
  children: ReactNode;
}

function ServiceLocatorProvider({ children }: ServiceLocatorProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const [services, setServices] = useState<Services | null>(null);

  useEffect(() => {
    const firebaseResources = FirebaseResources.getInstance();
    const identityService = new IdentityService(firebaseResources);

    setServices({
      firebaseResources,
      identityService,
    });
    setIsReady(true);
  }, []);

  const contextValue: ServiceLocatorContextValue = useMemo(
    () => ({
      services,
      isReady,
    }),
    [services, isReady],
  );

  return (
    <ServiceLocatorContext.Provider value={contextValue}>
      {children}
    </ServiceLocatorContext.Provider>
  );
}

export default ServiceLocatorProvider;
