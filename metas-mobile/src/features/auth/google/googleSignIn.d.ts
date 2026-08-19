export type GoogleSignInResult = { idToken: string; type: 'success' } | { type: 'cancelled' };

export interface GoogleSignInGateway {
  signIn(): Promise<GoogleSignInResult>;
  signOut(): Promise<void>;
}

export const googleSignInGateway: GoogleSignInGateway;
