import { useState, useEffect } from 'react';
import { useServiceLocator } from '../ServiceLocatorContext';
import { AuthUser } from '../identity/Identity';

export interface UseAuthResult {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isMember: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const { services, isReady } = useServiceLocator();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isReady || !services) {
      return;
    }

    const { identityService } = services;

    // Set initial user state
    setUser(identityService.currentUser);
    setIsLoading(false);

    // Subscribe to auth state changes
    const unsubscribe = identityService.onAuthStateChanged((authUser) => {
      setUser(authUser);
      setIsLoading(false);
    });

    return unsubscribe;
  }, [services, isReady]);

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

  const register = async (email: string, password: string): Promise<void> => {
    if (!services) {
      throw new Error('Services not ready');
    }
    await services.identityService.register(email, password);
  };

  return {
    user,
    isLoading: !isReady || isLoading,
    isAuthenticated: user !== null,
    isMember: user?.role === 'member' || user?.role === 'admin',
    isAdmin: user?.role === 'admin',
    signIn,
    signOut,
    register,
  };
}

export default useAuth;
