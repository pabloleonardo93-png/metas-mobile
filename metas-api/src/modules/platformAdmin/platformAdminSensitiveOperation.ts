import type { RequestHandler } from 'express';

import { AppError } from '../../shared/errors/AppError.js';
import {
  PlatformAdminRateLimitStoreUnavailableError,
  type PlatformAdminRateLimiter,
} from './platformAdminRateLimiter.js';
import { requireRecentPlatformAdminStepUp } from './requireRecentPlatformAdminStepUp.js';

export const createPlatformAdminSensitiveOperation =
  (rateLimiter: PlatformAdminRateLimiter, stepUpTtlSeconds: number): RequestHandler =>
  (request, response, next) => {
    const session = request.platformAdminSession!;
    try {
      requireRecentPlatformAdminStepUp(session, stepUpTtlSeconds);
    } catch (error) {
      next(error);
      return;
    }
    void rateLimiter
      .consume('ADMIN_ACCESS_WRITE', [
        session.platformAdminId,
        session.sessionId,
        request.ip || 'unresolved',
      ])
      .then((decision) => {
        if (!decision.allowed) {
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          response.status(429).json({
            code: 'TOO_MANY_REQUESTS',
            message: 'Muitas tentativas. Tente novamente mais tarde.',
            requestId: request.requestId,
          });
          return;
        }
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof PlatformAdminRateLimitStoreUnavailableError) {
          next(
            new AppError(
              503,
              'PLATFORM_ADMIN_RATE_LIMIT_UNAVAILABLE',
              'A operação administrativa está temporariamente indisponível.',
            ),
          );
          return;
        }
        next(error);
      });
  };
