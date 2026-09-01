import { z } from 'zod';

import type { AdminBffConfig } from '../config.js';
import { BffError } from '../errors.js';

export type MetasApiPath =
  | '/v1/platform-admin/auth/google'
  | '/v1/platform-admin/auth/logout'
  | '/v1/platform-admin/me'
  | '/v1/platform-admin/mfa/webauthn/authentication/options'
  | '/v1/platform-admin/mfa/webauthn/authentication/verify'
  | '/v1/platform-admin/mfa/webauthn/registration/options'
  | '/v1/platform-admin/mfa/webauthn/registration/verify';

export interface MetasApiRequest {
  body?: unknown;
  method: 'GET' | 'POST';
  path: MetasApiPath;
  requestId: string;
  sessionToken?: string;
}

const upstreamErrorSchema = z
  .object({
    code: z.string().max(100),
  })
  .passthrough();

const allowedErrorCodes = new Set([
  'INVALID_GOOGLE_TOKEN',
  'INVALID_INPUT',
  'PLATFORM_ADMIN_ACCESS_NOT_AUTHORIZED',
  'TOO_MANY_REQUESTS',
  'UNAUTHORIZED',
  'WEBAUTHN_CREDENTIAL_REQUIRED',
  'WEBAUTHN_VERIFICATION_DENIED',
]);

const errorMessageFor = (status: number, code: string): string => {
  if (code === 'INVALID_GOOGLE_TOKEN' || code === 'PLATFORM_ADMIN_ACCESS_NOT_AUTHORIZED') {
    return 'Não foi possível autorizar este acesso.';
  }
  if (code === 'WEBAUTHN_CREDENTIAL_REQUIRED') return 'Nenhuma passkey está cadastrada.';
  if (code === 'WEBAUTHN_VERIFICATION_DENIED') return 'Não foi possível validar a passkey.';
  if (status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (status === 403) return 'Você não tem permissão para esta operação.';
  if (status === 409) return 'A operação não pôde ser concluída no estado atual.';
  if (status === 422) return 'Revise os dados informados.';
  if (status === 429) return 'Muitas tentativas. Aguarde antes de tentar novamente.';
  return 'Não foi possível concluir a operação.';
};

const mapUpstreamError = (status: number, body: unknown): BffError => {
  const parsed = upstreamErrorSchema.safeParse(body);
  const upstreamCode = parsed.success ? parsed.data.code : '';
  const code = allowedErrorCodes.has(upstreamCode)
    ? upstreamCode
    : status === 401
      ? 'UNAUTHORIZED'
      : status === 429
        ? 'TOO_MANY_REQUESTS'
        : 'UPSTREAM_REQUEST_FAILED';
  return new BffError(
    status >= 400 && status < 500 ? status : 502,
    code,
    errorMessageFor(status, code),
  );
};

const readJsonBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  if (Buffer.byteLength(text, 'utf8') > 1_048_576) {
    throw new BffError(502, 'UPSTREAM_RESPONSE_TOO_LARGE', 'Resposta inválida do serviço.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BffError(502, 'UPSTREAM_INVALID_RESPONSE', 'Resposta inválida do serviço.');
  }
};

export interface MetasApiClient {
  request(request: MetasApiRequest): Promise<unknown>;
}

export const createMetasApiClient = (
  config: AdminBffConfig,
  fetchImplementation: typeof fetch = fetch,
): MetasApiClient => ({
  async request(request) {
    const headers = new Headers({
      accept: 'application/json',
      'x-request-id': request.requestId,
    });
    if (request.body !== undefined) headers.set('content-type', 'application/json');
    if (request.sessionToken) headers.set('authorization', `Bearer ${request.sessionToken}`);

    let response: Response;
    try {
      response = await fetchImplementation(`${config.apiBaseUrl}${request.path}`, {
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        headers,
        method: request.method,
        redirect: 'error',
        signal: AbortSignal.timeout(config.apiTimeoutMs),
      });
    } catch {
      throw new BffError(503, 'UPSTREAM_UNAVAILABLE', 'Serviço temporariamente indisponível.');
    }

    const body = await readJsonBody(response);
    if (!response.ok) throw mapUpstreamError(response.status, body);
    return body;
  },
});
