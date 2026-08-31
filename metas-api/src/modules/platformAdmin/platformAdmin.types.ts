export type PlatformAdminAssuranceLevel = 'GOOGLE_ONLY' | 'MFA_VERIFIED';

export interface PlatformAdminSession {
  assuranceLevel: PlatformAdminAssuranceLevel;
  expiresAt: string;
  mfaVerifiedAt: string | null;
  platformAdminId: string;
  sessionId: string;
  stepUpVerifiedAt: string | null;
}

export interface PlatformAdminRequestMetadata {
  ipAddress: string | null;
  requestId: string;
  userAgent: string | null;
}

export interface PlatformAdminLoginResult {
  admin: {
    assuranceLevel: PlatformAdminAssuranceLevel;
    displayName: string;
    id: string;
    primaryEmail: string;
  };
  expiresAt: string;
  sessionToken: string;
}

export interface PlatformAdminMeResult {
  assuranceLevel: PlatformAdminAssuranceLevel;
  displayName: string;
  id: string;
  primaryEmail: string;
  status: 'ACTIVE' | 'DISABLED';
}

export interface PlatformAdminAuthenticationService {
  authenticateSession(rawToken: string): Promise<PlatformAdminSession>;
  getMe(session: PlatformAdminSession): Promise<PlatformAdminMeResult>;
  loginWithGoogle(
    idToken: string,
    metadata: PlatformAdminRequestMetadata,
  ): Promise<PlatformAdminLoginResult>;
  logout(session: PlatformAdminSession, metadata: PlatformAdminRequestMetadata): Promise<void>;
}
