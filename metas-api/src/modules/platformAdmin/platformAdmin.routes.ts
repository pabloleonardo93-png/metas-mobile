import { Router, type Request, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import { AppError } from '../../shared/errors/AppError.js';
import type { Logger } from '../../shared/logging/logger.js';
import { createAuthenticatePlatformAdminSession } from './authenticatePlatformAdminSession.js';
import type {
  PlatformAdminAuthenticationService,
  PlatformAdminRequestMetadata,
  PlatformAdminSession,
} from './platformAdmin.types.js';

const googleLoginSchema = z
  .object({
    idToken: z.string().min(20).max(16_384),
  })
  .strict();

export interface PlatformAdminRateLimitOptions {
  limit: number;
  windowMs: number;
}

interface PlatformAdminRouterOptions {
  authenticationService: PlatformAdminAuthenticationService;
  logger: Logger;
  rateLimitOptions?: PlatformAdminRateLimitOptions;
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

export const createPlatformAdminRouter = ({
  authenticationService,
  logger,
  rateLimitOptions = { limit: 5, windowMs: 15 * 60 * 1000 },
}: PlatformAdminRouterOptions): Router => {
  const router = Router();
  const authenticateSession = createAuthenticatePlatformAdminSession(authenticationService);
  const loginRateLimit = rateLimit({
    legacyHeaders: false,
    limit: rateLimitOptions.limit,
    standardHeaders: 'draft-8',
    windowMs: rateLimitOptions.windowMs,
    handler: (request, response) => {
      logger.info('PLATFORM_ADMIN_LOGIN_RATE_LIMITED', { requestId: request.requestId });
      response.status(429).json({
        code: 'TOO_MANY_REQUESTS',
        message: 'Muitas tentativas. Tente novamente mais tarde.',
        requestId: request.requestId,
      });
    },
  });

  router.post(
    '/auth/google',
    loginRateLimit,
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

  return router;
};
