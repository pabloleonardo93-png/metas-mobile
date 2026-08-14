import type {
  AuthUser,
  GoogleLoginRequest,
  GoogleLoginResponse,
} from '@/features/auth/types/auth.types';
import { apiRequest } from '@/shared/api/apiClient';

export interface AuthApi {
  getMe(sessionToken: string): Promise<AuthUser>;
  loginWithGoogle(request: GoogleLoginRequest): Promise<GoogleLoginResponse>;
  logout(sessionToken: string): Promise<void>;
}

export const authApi: AuthApi = {
  getMe: (sessionToken) => apiRequest<AuthUser>('/v1/me', { sessionToken }),
  loginWithGoogle: (body) =>
    apiRequest<GoogleLoginResponse>('/v1/auth/google', { body, method: 'POST' }),
  logout: (sessionToken) => apiRequest<void>('/v1/auth/logout', { method: 'POST', sessionToken }),
};
