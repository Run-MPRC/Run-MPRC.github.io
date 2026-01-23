import { createContext, useContext } from 'react';
import FirebaseResources from './firebase/FirebaseResources';
import IdentityService from './identity/Identity';

export interface Services {
  firebaseResources: FirebaseResources;
  identityService: IdentityService;
}

export interface ServiceLocatorContextValue {
  services: Services | null;
  isReady: boolean;
}

const ServiceLocatorContext = createContext<ServiceLocatorContextValue>({
  services: null,
  isReady: false,
});

export function useServices(): Services {
  const { services, isReady } = useContext(ServiceLocatorContext);
  if (!isReady || !services) {
    throw new Error('Services are not ready yet. Ensure ServiceLocatorProvider is mounted.');
  }
  return services;
}

export function useServiceLocator(): ServiceLocatorContextValue {
  return useContext(ServiceLocatorContext);
}

export function useIdentityService(): IdentityService {
  const { identityService } = useServices();
  return identityService;
}

export function useFirebaseResources(): FirebaseResources {
  const { firebaseResources } = useServices();
  return firebaseResources;
}

export default ServiceLocatorContext;
