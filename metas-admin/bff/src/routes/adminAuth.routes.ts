import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { z } from 'zod';

import type { AdminBffConfig } from '../config.js';
import { BffError } from '../errors.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '../http/cookies.js';
import { issueCsrfToken } from '../security/csrf.js';
import type { MetasApiClient, MetasApiPath } from '../upstream/metasApiClient.js';
import {
  adminMeSchema,
  authenticationOptionsResponseSchema,
  authenticationVerificationSchema,
  emptyBodySchema,
  firstEnrollmentRequestResponseSchema,
  googleLoginSchema,
  loginResponseSchema,
  registrationOptionsResponseSchema,
  registrationVerificationSchema,
  verificationResponseSchema,
} from './contracts.js';

const asyncHandler =
  (handler: (request: Request, response: Response) => Promise<void>): RequestHandler =>
  (request, response, next) => {
    void handler(request, response).catch(next);
  };

const requireSessionToken = (request: Request, config: AdminBffConfig): string => {
  const token = readSessionToken(request.get('cookie'), config);
  if (!token) throw new BffError(401, 'UNAUTHORIZED', 'Autenticação administrativa necessária.');
  return token;
};

const parseBody = <Schema extends z.ZodType>(schema: Schema, body: unknown): z.output<Schema> => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BffError(422, 'INVALID_INPUT', 'Revise os dados informados.');
  return parsed.data;
};

const parseUpstream = <Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
): z.output<Schema> => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BffError(502, 'UPSTREAM_INVALID_RESPONSE', 'Resposta inválida do serviço.');
  }
  return parsed.data;
};

const toAdminSessionView = (admin: {
  assuranceLevel: 'GOOGLE_ONLY' | 'MFA_VERIFIED';
  displayName: string;
  hasWebAuthnCredential?: boolean;
  primaryEmail: string;
}) => ({
  assuranceLevel: admin.assuranceLevel,
  displayName: admin.displayName,
  ...(admin.hasWebAuthnCredential === undefined
    ? {}
    : { hasWebAuthnCredential: admin.hasWebAuthnCredential }),
  primaryEmail: admin.primaryEmail,
});

const respondWithRotatedSession = (
  response: Response,
  config: AdminBffConfig,
  result: z.output<typeof verificationResponseSchema>,
): void => {
  setSessionCookie(response, result.sessionToken, config);
  const csrfToken = issueCsrfToken(response, config, result.sessionToken);
  response.status(200).json({
    assuranceLevel: result.assuranceLevel,
    csrfToken,
    mfaVerifiedAt: result.mfaVerifiedAt,
    stepUpVerifiedAt: result.stepUpVerifiedAt,
  });
};

const requestWithSession = (
  request: Request,
  config: AdminBffConfig,
  client: MetasApiClient,
  method: 'GET' | 'POST',
  path: MetasApiPath,
  body?: unknown,
): Promise<unknown> =>
  client.request({
    ...(body === undefined ? {} : { body }),
    method,
    path,
    requestId: request.requestId,
    sessionToken: requireSessionToken(request, config),
  });

export const createAdminAuthRouter = (
  config: AdminBffConfig,
  client: MetasApiClient,
  csrfProtection: RequestHandler,
): Router => {
  const router = Router();

  router.get('/security/csrf', (request, response) => {
    const sessionToken = readSessionToken(request.get('cookie'), config);
    response.status(200).json({ csrfToken: issueCsrfToken(response, config, sessionToken) });
  });

  router.post(
    '/auth/google',
    csrfProtection,
    asyncHandler(async (request, response) => {
      const input = parseBody(googleLoginSchema, request.body);
      const upstream = parseUpstream(
        loginResponseSchema,
        await client.request({
          body: { idToken: input.credential },
          method: 'POST',
          path: '/v1/platform-admin/auth/google',
          requestId: request.requestId,
        }),
      );
      setSessionCookie(response, upstream.sessionToken, config);
      const csrfToken = issueCsrfToken(response, config, upstream.sessionToken);
      response.status(200).json({
        admin: toAdminSessionView(upstream.admin),
        csrfToken,
        expiresAt: upstream.expiresAt,
      });
    }),
  );

  router.get(
    '/auth/me',
    asyncHandler(async (request, response) => {
      try {
        const result = parseUpstream(
          adminMeSchema,
          await requestWithSession(request, config, client, 'GET', '/v1/platform-admin/me'),
        );
        response.status(200).json(toAdminSessionView(result));
      } catch (error) {
        if (error instanceof BffError && error.statusCode === 401) {
          clearSessionCookie(response, config);
        }
        throw error;
      }
    }),
  );

  router.post(
    '/auth/logout',
    csrfProtection,
    asyncHandler(async (request, response) => {
      parseBody(emptyBodySchema, request.body ?? {});
      try {
        await requestWithSession(request, config, client, 'POST', '/v1/platform-admin/auth/logout');
      } catch (error) {
        if (!(error instanceof BffError && error.statusCode === 401)) throw error;
      } finally {
        clearSessionCookie(response, config);
      }
      const csrfToken = issueCsrfToken(response, config, null);
      response.status(200).json({ csrfToken });
    }),
  );

  router.post(
    '/mfa/first-enrollment/request',
    csrfProtection,
    asyncHandler(async (request, response) => {
      parseBody(emptyBodySchema, request.body ?? {});
      const result = parseUpstream(
        firstEnrollmentRequestResponseSchema,
        await requestWithSession(
          request,
          config,
          client,
          'POST',
          '/v1/platform-admin/mfa/first-enrollment/request',
          {},
        ),
      );
      response.status(202).json(result);
    }),
  );

  router.post(
    '/mfa/webauthn/registration/options',
    csrfProtection,
    asyncHandler(async (request, response) => {
      parseBody(emptyBodySchema, request.body ?? {});
      const result = parseUpstream(
        registrationOptionsResponseSchema,
        await requestWithSession(
          request,
          config,
          client,
          'POST',
          '/v1/platform-admin/mfa/webauthn/registration/options',
          {},
        ),
      );
      response.status(200).json(result);
    }),
  );

  router.post(
    '/mfa/webauthn/registration/verify',
    csrfProtection,
    asyncHandler(async (request, response) => {
      const input = parseBody(registrationVerificationSchema, request.body);
      const result = parseUpstream(
        verificationResponseSchema,
        await requestWithSession(
          request,
          config,
          client,
          'POST',
          '/v1/platform-admin/mfa/webauthn/registration/verify',
          input,
        ),
      );
      respondWithRotatedSession(response, config, result);
    }),
  );

  router.post(
    '/mfa/webauthn/authentication/options',
    csrfProtection,
    asyncHandler(async (request, response) => {
      parseBody(emptyBodySchema, request.body ?? {});
      const result = parseUpstream(
        authenticationOptionsResponseSchema,
        await requestWithSession(
          request,
          config,
          client,
          'POST',
          '/v1/platform-admin/mfa/webauthn/authentication/options',
          {},
        ),
      );
      response.status(200).json(result);
    }),
  );

  router.post(
    '/mfa/webauthn/authentication/verify',
    csrfProtection,
    asyncHandler(async (request, response) => {
      const input = parseBody(authenticationVerificationSchema, request.body);
      const result = parseUpstream(
        verificationResponseSchema,
        await requestWithSession(
          request,
          config,
          client,
          'POST',
          '/v1/platform-admin/mfa/webauthn/authentication/verify',
          input,
        ),
      );
      respondWithRotatedSession(response, config, result);
    }),
  );

  return router;
};
