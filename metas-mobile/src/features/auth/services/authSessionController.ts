import type { GoogleSignInGateway } from '@/features/auth/google/googleSignIn';
import type { SessionTokenStorage } from '@/features/auth/storage/sessionTokenStorage';
import type {
  AuthUser,
  GoogleLoginRequest,
  GoogleLoginResponse,
} from '@/features/auth/types/auth.types';

interface AuthApiGateway {
  getMe(sessionToken: string): Promise<AuthUser>;
  loginWithGoogle(request: GoogleLoginRequest): Promise<GoogleLoginResponse>;
  logout(sessionToken: string): Promise<void>;
}

interface HttpErrorLike {
  status?: unknown;
}

function isUnauthorized(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return (error as HttpErrorLike).status === 401;
}

export class AuthSessionController {
  constructor(
    private readonly api: AuthApiGateway,
    private readonly storage: SessionTokenStorage,
    private readonly google: GoogleSignInGateway,
  ) {}

  async loginWithGoogle(): Promise<AuthUser | null> {
    const googleResult = await this.google.signIn();
    if (googleResult.type === 'cancelled') {
      return null;
    }

    const login = await this.api.loginWithGoogle({ idToken: googleResult.idToken });
    await this.storage.saveToken(login.sessionToken);

    try {
      return await this.api.getMe(login.sessionToken);
    } catch (error: unknown) {
      if (isUnauthorized(error)) {
        await this.storage.deleteToken();
      }
      throw error;
    }
  }

  async restoreSession(): Promise<AuthUser | null> {
    const sessionToken = await this.storage.getToken();
    if (!sessionToken) {
      return null;
    }

    try {
      return await this.api.getMe(sessionToken);
    } catch (error: unknown) {
      if (isUnauthorized(error)) {
        await this.storage.deleteToken();
        return null;
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    const sessionToken = await this.storage.getToken();

    try {
      if (sessionToken) {
        await this.api.logout(sessionToken);
      }
    } finally {
      await this.storage.deleteToken();
    }
  }

  async clearLocalSession(): Promise<void> {
    await this.storage.deleteToken();
  }
}
