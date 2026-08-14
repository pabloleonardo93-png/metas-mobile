export type GoogleSignInResult = { idToken: string; type: 'success' } | { type: 'cancelled' };

export interface GoogleSignInGateway {
  signIn(): Promise<GoogleSignInResult>;
}

export const googleSignInGateway: GoogleSignInGateway;
