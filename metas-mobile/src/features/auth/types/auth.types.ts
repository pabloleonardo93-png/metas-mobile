import type { UserRole } from '@/shared/types/userRole';

export interface AuthUser {
  email: string;
  id: string;
  joinedOn: string;
  name: string;
  role: UserRole;
  status: 'ATIVO' | 'INATIVO';
}

export interface GoogleLoginRequest {
  idToken: string;
}

export interface GoogleLoginResponse {
  expiresAt: string;
  sessionToken: string;
  user: Pick<AuthUser, 'id' | 'name' | 'role'>;
}

export type AuthStatus = 'authenticated' | 'restore-error' | 'restoring' | 'unauthenticated';

export type DemoArea = 'employee' | 'manager';
