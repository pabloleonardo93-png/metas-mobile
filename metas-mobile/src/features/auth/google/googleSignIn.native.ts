import { publicEnv } from '@/config/publicEnv';
import type { GoogleSignInGateway, GoogleSignInResult } from '@/features/auth/google/googleSignIn';

async function signIn(): Promise<GoogleSignInResult> {
  if (!publicEnv.isGoogleConfigured) {
    throw new Error('GOOGLE_NOT_CONFIGURED');
  }

  const {
    GoogleOneTapSignIn,
    isCancelledResponse,
    isErrorWithCode,
    isNoSavedCredentialFoundResponse,
    isSuccessResponse,
    statusCodes,
  } = await import('react-native-nitro-google-signin');

  GoogleOneTapSignIn.configure({
    autoSelectOnSignIn: false,
    webClientId: publicEnv.googleWebClientId,
  });

  try {
    await GoogleOneTapSignIn.checkPlayServices();
    let response = await GoogleOneTapSignIn.signIn();

    if (isNoSavedCredentialFoundResponse(response)) {
      response = await GoogleOneTapSignIn.createAccount();
    }
    if (isNoSavedCredentialFoundResponse(response)) {
      response = await GoogleOneTapSignIn.presentExplicitSignIn();
    }
    if (isCancelledResponse(response)) {
      return { type: 'cancelled' };
    }
    if (!isSuccessResponse(response) || !response.data.idToken) {
      throw new Error('GOOGLE_SIGN_IN_FAILED');
    }

    return { idToken: response.data.idToken, type: 'success' };
  } catch (error: unknown) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
      return { type: 'cancelled' };
    }
    throw error;
  }
}

export const googleSignInGateway: GoogleSignInGateway = { signIn };
