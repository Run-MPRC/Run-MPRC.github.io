import { useEffect, useMemo, useState } from 'react';
import { useServiceLocator } from '../ServiceLocatorContext';
import type { AuthUser, RegistrationResult } from '../identity/Identity';

export interface UseAuthResult {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isMember: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  register: (email: string, password: string) => Promise<RegistrationResult>;
}

interface AuthSnapshot {
  contextToken: symbol | null;
  isLoading: boolean;
  user: AuthUser | null;
}

export function useAuth(): UseAuthResult {
  const { services, isReady } = useServiceLocator();
  const identityService = isReady && services ? services.identityService : null;
  const contextToken = useMemo(() => Symbol('auth-context'), [identityService]);
  const [authSnapshot, setAuthSnapshot] = useState<AuthSnapshot>({
    contextToken: null,
    isLoading: true,
    user: null,
  });

  useEffect(() => {
    if (!identityService) {
      return undefined;
    }

    let active = true;
    const publishUser = (authUser: AuthUser | null) => {
      if (!active) return;
      setAuthSnapshot({
        contextToken,
        isLoading: false,
        user: authUser,
      });
    };

    // Set initial user state
    publishUser(identityService.currentUser);

    // Subscribe to auth state changes
    const unsubscribe = identityService.onAuthStateChanged(publishUser);

    return () => {
      active = false;
      unsubscribe();
    };
  }, [contextToken, identityService]);

  const snapshotIsCurrent = identityService !== null
    && authSnapshot.contextToken === contextToken;
  const user = snapshotIsCurrent ? authSnapshot.user : null;
  const isLoading = !snapshotIsCurrent || authSnapshot.isLoading;

  const signIn = async (email: string, password: string): Promise<void> => {
    if (!services) {
      throw new Error('Services not ready');
    }
    await services.identityService.signIn(email, password);
  };

  const signOut = async (): Promise<void> => {
    if (!services) {
      throw new Error('Services not ready');
    }
    await services.identityService.signOut();
  };

  const register = async (
    email: string,
    password: string,
  ): Promise<RegistrationResult> => {
    if (!services) {
      throw new Error('Services not ready');
    }
    return services.identityService.register(email, password);
  };

  return {
    user,
    isLoading,
    isAuthenticated: user !== null,
    isMember: user?.role === 'member' || user?.role === 'admin',
    isAdmin: user?.role === 'admin',
    signIn,
    signOut,
    register,
  };
}

export default useAuth;
