export type AssuranceLevel = 'GOOGLE_ONLY' | 'MFA_VERIFIED';

export interface AdminIdentity {
  assuranceLevel: AssuranceLevel;
  displayName: string;
  primaryEmail: string;
}

export interface WebAuthnOptionsResult {
  challengeId: string;
  options: Record<string, unknown>;
}

export interface WebAuthnAuthenticationOptionsResult extends WebAuthnOptionsResult {
  purpose: 'AUTHENTICATION' | 'STEP_UP';
}
