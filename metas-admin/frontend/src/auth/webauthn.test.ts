import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminApi } from '../api/adminApi';

const startAuthentication = vi.fn();
const startRegistration = vi.fn();

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication,
  startRegistration,
}));

describe('WebAuthn browser adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completes first enrollment through explicit BFF endpoints', async () => {
    const options = { challenge: 'registration-challenge' };
    vi.spyOn(adminApi, 'createRegistrationOptions').mockResolvedValue({
      challengeId: '11111111-1111-4111-8111-111111111111',
      options,
    });
    const verifyRegistration = vi.spyOn(adminApi, 'verifyRegistration').mockResolvedValue();
    startRegistration.mockResolvedValue({ id: 'credential' });
    const { registerFirstPasskey } = await import('./webauthn');

    await registerFirstPasskey();

    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: options });
    expect(verifyRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: '11111111-1111-4111-8111-111111111111',
        response: { id: 'credential' },
      }),
    );
  });

  it('authenticates a registered passkey and returns only through the BFF', async () => {
    const options = { challenge: 'authentication-challenge' };
    vi.spyOn(adminApi, 'createAuthenticationOptions').mockResolvedValue({
      challengeId: '22222222-2222-4222-8222-222222222222',
      options,
      purpose: 'AUTHENTICATION',
    });
    const verifyAuthentication = vi.spyOn(adminApi, 'verifyAuthentication').mockResolvedValue();
    startAuthentication.mockResolvedValue({ id: 'credential' });
    const { authenticateWithPasskey } = await import('./webauthn');

    await authenticateWithPasskey();

    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
    expect(verifyAuthentication).toHaveBeenCalledWith({
      challengeId: '22222222-2222-4222-8222-222222222222',
      response: { id: 'credential' },
    });
  });

  it('maps authenticator cancellation without exposing browser internals', async () => {
    const { describeWebAuthnError } = await import('./webauthn');
    expect(describeWebAuthnError(new DOMException('raw browser detail', 'NotAllowedError'))).toBe(
      'A operação foi cancelada ou expirou. Tente novamente.',
    );
  });
});
