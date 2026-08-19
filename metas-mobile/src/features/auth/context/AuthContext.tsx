import { createContext, useContext } from 'react';

import type { AuthStatus, AuthUser } from '@/features/auth/types/auth.types';
import type { EmployeeRole } from '@/shared/types/userRole';

export interface AuthContextValue {
  errorMessage: string | null;
  isAuthenticating: boolean;
  status: AuthStatus;
  user: AuthUser | null;
  clearLocalSession(): Promise<void>;
  loginWithGoogle(): Promise<void>;
  logout(): Promise<void>;
  retryRestore(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}

export function useAuthenticatedUser(): AuthUser {
  const { user } = useAuth();
  if (!user) {
    throw new Error('Authenticated user is unavailable');
  }
  return user;
}

export function useAuthenticatedEmployee(): AuthUser & { role: EmployeeRole } {
  const user = useAuthenticatedUser();
  if (user.role === 'GESTOR') {
    throw new Error('Manager cannot use an employee screen');
  }
  return { ...user, role: user.role };
}
