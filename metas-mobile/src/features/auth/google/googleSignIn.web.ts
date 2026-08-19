import type { GoogleSignInGateway } from '@/features/auth/google/googleSignIn';

export const googleSignInGateway: GoogleSignInGateway = {
  signIn: async () => {
    throw new Error('GOOGLE_NATIVE_ONLY');
  },
  signOut: async () => undefined,
};
