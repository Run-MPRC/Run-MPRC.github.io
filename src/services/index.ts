// Context and Provider
export { default as ServiceLocatorContext } from './ServiceLocatorContext';
export { default as ServiceLocatorProvider } from './ServiceLocatorProvider';
export {
  useServices,
  useServiceLocator,
  useIdentityService,
  useFirebaseResources,
} from './ServiceLocatorContext';
export type { Services, ServiceLocatorContextValue } from './ServiceLocatorContext';

// Firebase
export { default as FirebaseResources } from './firebase/FirebaseResources';

// Identity
export { default as IdentityService } from './identity/Identity';
export type { UserRole, AuthUser } from './identity/Identity';

// Hooks
export { useAuth } from './hooks/useAuth';
export type { UseAuthResult } from './hooks/useAuth';

// SEO Utilities
export {
  ORGANIZATION_INFO,
  createOrganizationSchema,
  createSportsOrganizationSchema,
  createSaturdayRunEventSchema,
  createPageSchema,
  createContactPageSchema,
  createJoinUsPageSchema,
} from './seo';
export type { StructuredDataOptions } from './seo';
