import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

import type { PlatformAdminRequestMetadata, PlatformAdminSession } from './platformAdmin.types.js';

export type PlatformAdminWebAuthnPurpose = 'AUTHENTICATION' | 'REGISTRATION' | 'STEP_UP';

export interface PlatformAdminWebAuthnOptionsResult<Options> {
  challengeId: string;
  options: Options;
}

export interface PlatformAdminWebAuthnAuthenticationOptionsResult extends PlatformAdminWebAuthnOptionsResult<PublicKeyCredentialRequestOptionsJSON> {
  purpose: Exclude<PlatformAdminWebAuthnPurpose, 'REGISTRATION'>;
}

export interface PlatformAdminWebAuthnVerificationResult {
  assuranceLevel: 'MFA_VERIFIED';
  mfaVerifiedAt: string;
  sessionToken: string;
  stepUpVerifiedAt: string;
}

export type PlatformAdminFirstEnrollmentRequestStatus = 'APPROVED' | 'PENDING';

export interface PlatformAdminFirstEnrollmentRequestResult {
  approvalExpiresAt: string | null;
  expiresAt: string;
  requestId: string;
  status: PlatformAdminFirstEnrollmentRequestStatus;
}

export interface PlatformAdminWebAuthnService {
  createAuthenticationOptions(
    session: PlatformAdminSession,
  ): Promise<PlatformAdminWebAuthnAuthenticationOptionsResult>;
  createRegistrationOptions(
    session: PlatformAdminSession,
  ): Promise<PlatformAdminWebAuthnOptionsResult<PublicKeyCredentialCreationOptionsJSON>>;
  requestFirstEnrollment(
    session: PlatformAdminSession,
    metadata: PlatformAdminRequestMetadata,
  ): Promise<PlatformAdminFirstEnrollmentRequestResult>;
  verifyAuthentication(
    session: PlatformAdminSession,
    challengeId: string,
    response: AuthenticationResponseJSON,
    metadata: PlatformAdminRequestMetadata,
  ): Promise<PlatformAdminWebAuthnVerificationResult>;
  verifyRegistration(
    session: PlatformAdminSession,
    challengeId: string,
    response: RegistrationResponseJSON,
    friendlyName: string | null,
    metadata: PlatformAdminRequestMetadata,
  ): Promise<PlatformAdminWebAuthnVerificationResult>;
}
