import { z } from 'zod';

import type {
  AdminIdentity,
  WebAuthnAuthenticationOptionsResult,
  WebAuthnOptionsResult,
} from '../types';

const errorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  })
  .strict();
const csrfSchema = z.object({ csrfToken: z.string().min(1) }).strict();
const meSchema = z
  .object({
    assuranceLevel: z.enum(['GOOGLE_ONLY', 'MFA_VERIFIED']),
    displayName: z.string(),
    primaryEmail: z.string(),
  })
  .strict();
const loginSchema = z
  .object({
    admin: meSchema,
    csrfToken: z.string().min(1),
    expiresAt: z.string(),
  })
  .strict();
const optionsSchema = z
  .object({
    challengeId: z.string().uuid(),
    options: z.record(z.string(), z.unknown()),
  })
  .strict();
const authenticationOptionsSchema = optionsSchema
  .extend({
    purpose: z.enum(['AUTHENTICATION', 'STEP_UP']),
  })
  .strict();
const verificationSchema = z
  .object({
    assuranceLevel: z.literal('MFA_VERIFIED'),
    csrfToken: z.string().min(1),
    mfaVerifiedAt: z.string(),
    stepUpVerifiedAt: z.string(),
  })
  .strict();

export class AdminApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

let csrfToken: string | null = null;

const readResponse = async (response: Response): Promise<unknown> => {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AdminApiError(502, 'INVALID_RESPONSE', 'Resposta inválida do servidor.');
  }
};

const request = async (path: string, init: RequestInit = {}): Promise<unknown> => {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...init.headers },
    mode: 'same-origin',
  });
  const body = await readResponse(response);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body);
    throw new AdminApiError(
      response.status,
      parsed.success ? parsed.data.code : 'REQUEST_FAILED',
      parsed.success ? parsed.data.message : 'Não foi possível concluir a operação.',
    );
  }
  return body;
};

const refreshCsrfToken = async (): Promise<string> => {
  const parsed = csrfSchema.parse(await request('/api/security/csrf'));
  csrfToken = parsed.csrfToken;
  return parsed.csrfToken;
};

const mutation = async (path: string, body: unknown, retry = true): Promise<unknown> => {
  const token = csrfToken ?? (await refreshCsrfToken());
  try {
    return await request(path, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      method: 'POST',
    });
  } catch (error) {
    if (retry && error instanceof AdminApiError && error.code === 'CSRF_VALIDATION_FAILED') {
      csrfToken = null;
      await refreshCsrfToken();
      return mutation(path, body, false);
    }
    throw error;
  }
};

const storeRotatedCsrf = <Result extends { csrfToken: string }>(result: Result): Result => {
  csrfToken = result.csrfToken;
  return result;
};

export const adminApi = {
  async getMe(): Promise<AdminIdentity> {
    return meSchema.parse(await request('/api/auth/me'));
  },

  async loginWithGoogle(credential: string): Promise<void> {
    const result = loginSchema.parse(await mutation('/api/auth/google', { credential }));
    storeRotatedCsrf(result);
  },

  async logout(): Promise<void> {
    const result = csrfSchema.parse(await mutation('/api/auth/logout', {}));
    storeRotatedCsrf(result);
  },

  async createRegistrationOptions(): Promise<WebAuthnOptionsResult> {
    return optionsSchema.parse(await mutation('/api/mfa/webauthn/registration/options', {}));
  },

  async verifyRegistration(input: {
    challengeId: string;
    friendlyName: string | null;
    response: unknown;
  }): Promise<void> {
    const result = verificationSchema.parse(
      await mutation('/api/mfa/webauthn/registration/verify', input),
    );
    storeRotatedCsrf(result);
  },

  async createAuthenticationOptions(): Promise<WebAuthnAuthenticationOptionsResult> {
    return authenticationOptionsSchema.parse(
      await mutation('/api/mfa/webauthn/authentication/options', {}),
    );
  },

  async verifyAuthentication(input: { challengeId: string; response: unknown }): Promise<void> {
    const result = verificationSchema.parse(
      await mutation('/api/mfa/webauthn/authentication/verify', input),
    );
    storeRotatedCsrf(result);
  },
};

export const resetAdminApiStateForTests = (): void => {
  csrfToken = null;
};
