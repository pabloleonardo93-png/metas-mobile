import type { UserRole } from '@/shared/types/userRole';

export type AuthenticatedArea = 'employee' | 'manager';

export function getAuthenticatedArea(role: UserRole): AuthenticatedArea {
  return role === 'GESTOR' ? 'manager' : 'employee';
}
