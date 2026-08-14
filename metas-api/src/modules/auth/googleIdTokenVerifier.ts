import { OAuth2Client, type LoginTicket, type TokenPayload } from 'google-auth-library';

import type { GoogleIdTokenVerifier, VerifiedGoogleIdentity } from './auth.types.js';

interface GoogleTokenClient {
  verifyIdToken(options: { audience: string | string[]; idToken: string }): Promise<LoginTicket>;
}

export class GoogleProviderNotConfiguredError extends Error {
  public constructor() {
    super('Google authentication is not configured.');
    this.name = 'GoogleProviderNotConfiguredError';
  }
}

export class InvalidGoogleIdTokenError extends Error {
  public constructor() {
    super('Google ID token is invalid.');
    this.name = 'InvalidGoogleIdTokenError';
  }
}

const isValidPayload = (
  payload: TokenPayload | undefined,
  allowedClientIds: readonly string[],
): payload is TokenPayload & { email: string; sub: string } => {
  if (!payload) {
    return false;
  }

  const issuerIsGoogle =
    payload.iss === 'accounts.google.com' || payload.iss === 'https://accounts.google.com';
  const audienceIsAllowed =
    typeof payload.aud === 'string' && allowedClientIds.includes(payload.aud);
  const expirationIsValid = typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();

  return (
    issuerIsGoogle &&
    audienceIsAllowed &&
    expirationIsValid &&
    typeof payload.sub === 'string' &&
    payload.sub.length > 0 &&
    payload.sub.length <= 255 &&
    typeof payload.email === 'string' &&
    payload.email.length > 0 &&
    payload.email.length <= 320 &&
    payload.email_verified === true
  );
};

export class OfficialGoogleIdTokenVerifier implements GoogleIdTokenVerifier {
  private readonly client: GoogleTokenClient;

  public constructor(
    private readonly allowedClientIds: readonly string[],
    client: GoogleTokenClient = new OAuth2Client(),
  ) {
    this.client = client;
  }

  public async verify(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (this.allowedClientIds.length === 0) {
      throw new GoogleProviderNotConfiguredError();
    }

    try {
      const ticket = await this.client.verifyIdToken({
        audience: [...this.allowedClientIds],
        idToken,
      });
      const payload = ticket.getPayload();
      if (!isValidPayload(payload, this.allowedClientIds)) {
        throw new InvalidGoogleIdTokenError();
      }

      return {
        email: payload.email.trim().toLowerCase(),
        subject: payload.sub,
      };
    } catch (error: unknown) {
      if (error instanceof GoogleProviderNotConfiguredError) {
        throw error;
      }
      throw new InvalidGoogleIdTokenError();
    }
  }
}
