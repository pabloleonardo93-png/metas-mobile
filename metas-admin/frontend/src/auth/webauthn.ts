import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';

import { adminApi } from '../api/adminApi';

type RegistrationOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

export const supportsWebAuthn = (): boolean => browserSupportsWebAuthn();

export const describeWebAuthnError = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'A operação foi cancelada ou expirou. Tente novamente.';
    }
    if (error.name === 'InvalidStateError') {
      return 'Esta passkey já está cadastrada para o acesso.';
    }
    if (error.name === 'NotSupportedError') {
      return 'Este dispositivo não oferece suporte à passkey solicitada.';
    }
  }
  return error instanceof Error && error.name === 'AdminApiError'
    ? error.message
    : 'Não foi possível validar a passkey. Tente novamente.';
};

export const registerFirstPasskey = async (): Promise<void> => {
  const result = await adminApi.createRegistrationOptions();
  const response = await startRegistration({
    optionsJSON: result.options as unknown as RegistrationOptions,
  });
  await adminApi.verifyRegistration({
    challengeId: result.challengeId,
    friendlyName: 'Passkey principal',
    response,
  });
};

export const recoverWithNewPasskey = async (): Promise<void> => {
  const result = await adminApi.createRecoveryRegistrationOptions();
  const response = await startRegistration({
    optionsJSON: result.options as unknown as RegistrationOptions,
  });
  await adminApi.verifyRecoveryRegistration({
    challengeId: result.challengeId,
    friendlyName: 'Passkey de recuperação',
    response,
  });
};

export const authenticateWithPasskey = async (): Promise<void> => {
  const result = await adminApi.createAuthenticationOptions();
  const response = await startAuthentication({
    optionsJSON: result.options as unknown as AuthenticationOptions,
  });
  await adminApi.verifyAuthentication({ challengeId: result.challengeId, response });
};
