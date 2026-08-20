import type { UserRole } from '@/shared/types/userRole';
import type { AuthStatus } from '@/features/auth/types/auth.types';

export type AuthenticatedArea = 'employee' | 'manager';

export function getAuthenticatedArea(role: UserRole): AuthenticatedArea {
  return role === 'GESTOR' ? 'manager' : 'employee';
}

export type AuthRouteGroup = '(auth)' | '(funcionario)' | '(gestor)' | string | undefined;
export type AuthRedirect = 'employee-home' | 'login' | 'manager-home';

export function getAuthRedirect(
  status: AuthStatus,
  role: UserRole | null,
  routeGroup: AuthRouteGroup,
): AuthRedirect | null {
  if (status === 'restoring' || status === 'restore-error') {
    return null;
  }

  if (status === 'unauthenticated') {
    return routeGroup === '(auth)' ? null : 'login';
  }

  if (!role) {
    return 'login';
  }

  if (role === 'GESTOR') {
    return routeGroup === '(gestor)' ? null : 'manager-home';
  }

  return routeGroup === '(funcionario)' ? null : 'employee-home';
}
