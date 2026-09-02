import { Router, type Request, type RequestHandler } from 'express';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';

import { AppError } from '../../shared/errors/AppError.js';
import type { Logger } from '../../shared/logging/logger.js';
import { createAuthenticatePlatformAdminSession } from './authenticatePlatformAdminSession.js';
import type {
  PlatformAdminAuthenticationService,
  PlatformAdminRequestMetadata,
  PlatformAdminSession,
} from './platformAdmin.types.js';
import {
  PlatformAdminRateLimitStoreUnavailableError,
  type PlatformAdminRateLimiter,
  type PlatformAdminRateLimitOperation,
} from './platformAdminRateLimiter.js';
import type { PlatformAdminWebAuthnService } from './platformAdminWebAuthn.types.js';

const googleLoginSchema = z
  .object({
    idToken: z.string().min(20).max(16_384),
  })
  .strict();

const base64UrlSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/u)
  .min(1)
  .max(65_536);
const authenticatorAttachmentSchema = z.enum(['cross-platform', 'platform']).optional();
const transportsSchema = z
  .array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']))
  .max(7)
  .optional();
const clientExtensionResultsSchema = z.record(z.string(), z.unknown());
const registrationResponseSchema = z
  .object({
    authenticatorAttachment: authenticatorAttachmentSchema,
    clientExtensionResults: clientExtensionResultsSchema,
    id: base64UrlSchema,
    rawId: base64UrlSchema,
    response: z
      .object({
        attestationObject: base64UrlSchema,
        authenticatorData: base64UrlSchema.optional(),
        clientDataJSON: base64UrlSchema,
        publicKey: base64UrlSchema.optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        transports: transportsSchema,
      })
      .strict(),
    type: z.literal('public-key'),
  })
  .strict();
const authenticationResponseSchema = z
  .object({
    authenticatorAttachment: authenticatorAttachmentSchema,
    clientExtensionResults: clientExtensionResultsSchema,
    id: base64UrlSchema,
    rawId: base64UrlSchema,
    response: z
      .object({
        authenticatorData: base64UrlSchema,
        clientDataJSON: base64UrlSchema,
        signature: base64UrlSchema,
        userHandle: base64UrlSchema.optional(),
      })
      .strict(),
    type: z.literal('public-key'),
  })
  .strict();
const registrationVerificationSchema = z
  .object({
    challengeId: z.uuid(),
    friendlyName: z.string().trim().min(1).max(100).nullable().optional(),
    response: registrationResponseSchema,
  })
  .strict();
const authenticationVerificationSchema = z
  .object({
    challengeId: z.uuid(),
    response: authenticationResponseSchema,
  })
  .strict();

interface PlatformAdminRouterOptions {
  authenticationService: PlatformAdminAuthenticationService;
  logger: Logger;
  rateLimiter: PlatformAdminRateLimiter;
  webAuthnService?: PlatformAdminWebAuthnService;
}

const asyncHandler =
  (
    handler: (request: Request, response: Parameters<RequestHandler>[1]) => Promise<void>,
  ): RequestHandler =>
  (request, response, next) => {
    void handler(request, response).catch(next);
  };

const requireSession = (request: Request): PlatformAdminSession => {
  if (!request.platformAdminSession) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação administrativa necessária.');
  }
  return request.platformAdminSession;
};

const metadataFromRequest = (request: Request): PlatformAdminRequestMetadata => ({
  ipAddress: request.ip || null,
  requestId: request.requestId,
  userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
});

const clientNetworkIdentity = (request: Request): string => request.ip || 'unresolved';

const authenticatedRateLimitIdentity = (request: Request): readonly string[] => {
  const session = requireSession(request);
  return [session.platformAdminId, session.sessionId, clientNetworkIdentity(request)];
};

export const createPlatformAdminRouter = ({
  authenticationService,
  logger,
  rateLimiter,
  webAuthnService,
}: PlatformAdminRouterOptions): Router => {
  const router = Router();
  const authenticateSession = createAuthenticatePlatformAdminSession(authenticationService);
  const createRateLimitGuard =
    (
      operation: PlatformAdminRateLimitOperation,
      identity: (request: Request) => readonly string[],
    ): RequestHandler =>
    (request, response, next) => {
      void rateLimiter
        .consume(operation, identity(request))
        .then((decision) => {
          if (decision.allowed) {
            next();
            return;
          }
          logger.info('PLATFORM_ADMIN_RATE_LIMITED', {
            operation,
            requestId: request.requestId,
          });
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          response.status(429).json({
            code: 'TOO_MANY_REQUESTS',
            message: 'Muitas tentativas. Tente novamente mais tarde.',
            requestId: request.requestId,
          });
        })
        .catch((error: unknown) => {
          if (error instanceof PlatformAdminRateLimitStoreUnavailableError) {
            next(
              new AppError(
                503,
                'PLATFORM_ADMIN_RATE_LIMIT_UNAVAILABLE',
                'A autentica\u00e7\u00e3o administrativa est\u00e1 temporariamente indispon\u00edvel.',
              ),
            );
            return;
          }
          next(error);
        });
    };

  const authenticatedRateLimit = (operation: PlatformAdminRateLimitOperation): RequestHandler =>
    createRateLimitGuard(operation, authenticatedRateLimitIdentity);

  router.post(
    '/auth/google',
    createRateLimitGuard('GOOGLE_LOGIN', (request) => [clientNetworkIdentity(request)]),
    asyncHandler(async (request, response) => {
      const parsed = googleLoginSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(422, 'INVALID_INPUT', 'Dados de autenticação inválidos.');
      }

      try {
        const result = await authenticationService.loginWithGoogle(
          parsed.data.idToken,
          metadataFromRequest(request),
        );
        logger.info('PLATFORM_ADMIN_LOGIN_SUCCESS', {
          platformAdminId: result.admin.id,
          requestId: request.requestId,
        });
        response.status(200).json(result);
      } catch (error: unknown) {
        logger.info('PLATFORM_ADMIN_LOGIN_DENIED', {
          errorType: error instanceof AppError ? error.code : 'UnknownError',
          requestId: request.requestId,
        });
        throw error;
      }
    }),
  );

  router.post(
    '/auth/logout',
    authenticateSession,
    asyncHandler(async (request, response) => {
      const session = requireSession(request);
      await authenticationService.logout(session, metadataFromRequest(request));
      logger.info('PLATFORM_ADMIN_LOGOUT', {
        platformAdminId: session.platformAdminId,
        requestId: request.requestId,
      });
      response.status(204).end();
    }),
  );

  router.get(
    '/me',
    authenticateSession,
    asyncHandler(async (request, response) => {
      response.status(200).json(await authenticationService.getMe(requireSession(request)));
    }),
  );

  if (webAuthnService) {
    router.post(
      '/mfa/first-enrollment/request',
      authenticateSession,
      authenticatedRateLimit('FIRST_ENROLLMENT_REQUEST'),
      asyncHandler(async (request, response) => {
        if (
          !z
            .object({})
            .strict()
            .safeParse(request.body ?? {}).success
        ) {
          throw new AppError(
            422,
            'INVALID_INPUT',
            'Dados da solicita\u00e7\u00e3o inv\u00e1lidos.',
          );
        }
        response
          .status(202)
          .json(
            await webAuthnService.requestFirstEnrollment(
              requireSession(request),
              metadataFromRequest(request),
            ),
          );
      }),
    );

    router.post(
      '/mfa/webauthn/registration/options',
      authenticateSession,
      authenticatedRateLimit('WEBAUTHN_REGISTRATION_OPTIONS'),
      asyncHandler(async (request, response) => {
        if (
          !z
            .object({})
            .strict()
            .safeParse(request.body ?? {}).success
        ) {
          throw new AppError(422, 'INVALID_INPUT', 'Dados da solicitação inválidos.');
        }
        response
          .status(200)
          .json(await webAuthnService.createRegistrationOptions(requireSession(request)));
      }),
    );

    router.post(
      '/mfa/webauthn/registration/verify',
      authenticateSession,
      authenticatedRateLimit('WEBAUTHN_REGISTRATION_VERIFY'),
      asyncHandler(async (request, response) => {
        const parsed = registrationVerificationSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError(422, 'INVALID_INPUT', 'Dados da passkey inválidos.');
        }
        const result = await webAuthnService.verifyRegistration(
          requireSession(request),
          parsed.data.challengeId,
          parsed.data.response as RegistrationResponseJSON,
          parsed.data.friendlyName ?? null,
          metadataFromRequest(request),
        );
        logger.info('PLATFORM_ADMIN_WEBAUTHN_REGISTRATION_SUCCESS', {
          platformAdminId: requireSession(request).platformAdminId,
          requestId: request.requestId,
        });
        response.status(200).json(result);
      }),
    );

    router.post(
      '/mfa/webauthn/authentication/options',
      authenticateSession,
      authenticatedRateLimit('WEBAUTHN_AUTHENTICATION_OPTIONS'),
      asyncHandler(async (request, response) => {
        if (
          !z
            .object({})
            .strict()
            .safeParse(request.body ?? {}).success
        ) {
          throw new AppError(422, 'INVALID_INPUT', 'Dados da solicitação inválidos.');
        }
        response
          .status(200)
          .json(await webAuthnService.createAuthenticationOptions(requireSession(request)));
      }),
    );

    router.post(
      '/mfa/webauthn/authentication/verify',
      authenticateSession,
      authenticatedRateLimit('WEBAUTHN_AUTHENTICATION_VERIFY'),
      asyncHandler(async (request, response) => {
        const parsed = authenticationVerificationSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new AppError(422, 'INVALID_INPUT', 'Dados da passkey inválidos.');
        }
        const result = await webAuthnService.verifyAuthentication(
          requireSession(request),
          parsed.data.challengeId,
          parsed.data.response as AuthenticationResponseJSON,
          metadataFromRequest(request),
        );
        logger.info('PLATFORM_ADMIN_WEBAUTHN_AUTHENTICATION_SUCCESS', {
          platformAdminId: requireSession(request).platformAdminId,
          requestId: request.requestId,
        });
        response.status(200).json(result);
      }),
    );
  }

  return router;
};
