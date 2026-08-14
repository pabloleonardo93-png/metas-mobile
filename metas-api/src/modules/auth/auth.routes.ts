import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import { AppError } from '../../shared/errors/AppError.js';
import type { Logger } from '../../shared/logging/logger.js';
import { createAuthenticateSession } from './authenticateSession.js';
import type { AuthenticationService } from './auth.types.js';

const googleLoginSchema = z
  .object({
    idToken: z.string().min(20).max(16_384),
  })
  .strict();

export interface AuthRateLimitOptions {
  limit: number;
  windowMs: number;
}

interface AuthRouterOptions {
  authenticationService: AuthenticationService;
  logger: Logger;
  rateLimitOptions?: AuthRateLimitOptions;
}

const asyncHandler =
  (
    handler: (
      request: Parameters<RequestHandler>[0],
      response: Parameters<RequestHandler>[1],
    ) => Promise<void>,
  ): RequestHandler =>
  (request, response, next) => {
    void handler(request, response).catch(next);
  };

const requireSession = (request: Parameters<RequestHandler>[0]) => {
  if (!request.authSession) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  }
  return request.authSession;
};

export const createAuthRouter = ({
  authenticationService,
  logger,
  rateLimitOptions = { limit: 10, windowMs: 15 * 60 * 1000 },
}: AuthRouterOptions): Router => {
  const router = Router();
  const authenticateSession = createAuthenticateSession(authenticationService);
  const loginRateLimit = rateLimit({
    legacyHeaders: false,
    limit: rateLimitOptions.limit,
    standardHeaders: 'draft-8',
    windowMs: rateLimitOptions.windowMs,
    handler: (request, response) => {
      logger.info('AUTH_LOGIN_RATE_LIMITED', { requestId: request.requestId });
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
        const result = await authenticationService.loginWithGoogle(parsed.data.idToken, {
          ipAddress: request.ip || null,
          userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
        });
        logger.info('AUTH_LOGIN_SUCCESS', {
          requestId: request.requestId,
          userId: result.user.id,
        });
        response.status(200).json(result);
      } catch (error: unknown) {
        logger.info('AUTH_LOGIN_DENIED', {
          requestId: request.requestId,
          errorType: error instanceof AppError ? error.code : 'UnknownError',
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
      await authenticationService.logout(session);
      logger.info('AUTH_LOGOUT', {
        employeeId: session.employeeId,
        requestId: request.requestId,
        userId: session.userId,
      });
      response.status(204).end();
    }),
  );

  router.get(
    '/me',
    authenticateSession,
    asyncHandler(async (request, response) => {
      const profile = await authenticationService.getMe(requireSession(request));
      response.status(200).json(profile);
    }),
  );

  return router;
};
