import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type GenerateAuthenticationOptionsOpts,
  type GenerateRegistrationOptionsOpts,
  type RegistrationResponseJSON,
  type VerifyAuthenticationResponseOpts,
  type VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server';

export interface PlatformAdminWebAuthnAdapter {
  generateAuthenticationOptions(
    options: GenerateAuthenticationOptionsOpts,
  ): ReturnType<typeof generateAuthenticationOptions>;
  generateRegistrationOptions(
    options: GenerateRegistrationOptionsOpts,
  ): ReturnType<typeof generateRegistrationOptions>;
  verifyAuthenticationResponse(
    options: VerifyAuthenticationResponseOpts & { response: AuthenticationResponseJSON },
  ): ReturnType<typeof verifyAuthenticationResponse>;
  verifyRegistrationResponse(
    options: VerifyRegistrationResponseOpts & { response: RegistrationResponseJSON },
  ): ReturnType<typeof verifyRegistrationResponse>;
}

export const officialPlatformAdminWebAuthnAdapter: PlatformAdminWebAuthnAdapter = {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
};
