export type AssuranceLevel = 'GOOGLE_ONLY' | 'MFA_VERIFIED';

export interface AdminIdentity {
  assuranceLevel: AssuranceLevel;
  displayName: string;
  hasWebAuthnCredential: boolean;
  primaryEmail: string;
}

export interface FirstEnrollmentRequestResult {
  approvalExpiresAt: string | null;
  expiresAt: string;
  requestId: string;
  status: 'APPROVED' | 'PENDING';
}

export interface WebAuthnOptionsResult {
  challengeId: string;
  options: Record<string, unknown>;
}

export interface WebAuthnAuthenticationOptionsResult extends WebAuthnOptionsResult {
  purpose: 'AUTHENTICATION' | 'STEP_UP';
}
