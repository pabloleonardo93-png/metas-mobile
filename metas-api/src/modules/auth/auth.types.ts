export type UserRole = 'BALCONISTA' | 'CAIXA' | 'FARMACEUTICO' | 'GESTOR';

export interface VerifiedGoogleIdentity {
  email: string;
  subject: string;
}

export interface GoogleIdTokenVerifier {
  verify(idToken: string): Promise<VerifiedGoogleIdentity>;
}

export interface AuthenticatedSession {
  employeeId: string;
  role: UserRole;
  storeId: string;
  tokenHash: Buffer;
  userId: string;
}

export interface LoginResult {
  expiresAt: string;
  sessionToken: string;
  user: {
    id: string;
    name: string;
    role: UserRole;
  };
}

export interface MeResult {
  email: string;
  id: string;
  joinedOn: string;
  name: string;
  role: UserRole;
  status: 'ATIVO' | 'INATIVO';
}

export interface LoginMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuthenticationService {
  authenticateSession(rawToken: string): Promise<AuthenticatedSession>;
  getMe(session: AuthenticatedSession): Promise<MeResult>;
  loginWithGoogle(idToken: string, metadata: LoginMetadata): Promise<LoginResult>;
  logout(session: AuthenticatedSession): Promise<void>;
}
