import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';

import { AppError } from '../../shared/errors/AppError.js';
import { createAuthenticatePlatformAdminSession } from '../platformAdmin/authenticatePlatformAdminSession.js';
import {
  PlatformAdminRateLimitStoreUnavailableError,
  type PlatformAdminRateLimiter,
} from '../platformAdmin/platformAdminRateLimiter.js';
import type {
  PlatformAdminAuthenticationService,
  PlatformAdminSession,
} from '../platformAdmin/platformAdmin.types.js';
import { requireRecentPlatformAdminStepUp } from '../platformAdmin/requireRecentPlatformAdminStepUp.js';
import { platformAdminInvitationInputSchema } from './platformAdminAccess.contracts.js';
import type { PlatformAdminAccessService } from './platformAdminAccess.service.js';

const parse = <T extends z.ZodType>(schema: T, value: unknown): z.output<T> => {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(422, 'INVALID_INPUT', 'Revise os dados informados.');
  return result.data;
};

const sessionFrom = (request: Request): PlatformAdminSession => request.platformAdminSession!;

export const createPlatformAdminAccessRouter = (
  authentication: PlatformAdminAuthenticationService,
  service: PlatformAdminAccessService,
  rateLimiter: PlatformAdminRateLimiter,
  stepUpTtlSeconds: number,
): Router => {
  const router = Router();
  router.use(createAuthenticatePlatformAdminSession(authentication));
  router.use((request, response, next) => {
    response.setHeader('cache-control', 'no-store');
    if (sessionFrom(request).assuranceLevel !== 'MFA_VERIFIED') {
      next(new AppError(403, 'MANAGEMENT_MFA_REQUIRED', 'Confirme sua identidade para continuar.'));
      return;
    }
    next();
  });
  const sensitiveOperation: RequestHandler = (request, response, next) => {
    try {
      requireRecentPlatformAdminStepUp(sessionFrom(request), stepUpTtlSeconds);
    } catch (error) {
      next(error);
      return;
    }
    const session = sessionFrom(request);
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

  router.get('/', async (request, response) => {
    response.json(await service.list(sessionFrom(request)));
  });
  router.post('/', sensitiveOperation, async (request, response) => {
    const input = parse(platformAdminInvitationInputSchema, request.body);
    response.status(201).json(await service.invite(sessionFrom(request), input, request.requestId));
  });
  router.post('/:invitationId/cancel', sensitiveOperation, async (request, response) => {
    parse(z.object({}).strict(), request.body ?? {});
    const invitationId = parse(z.uuid(), request.params.invitationId);
    response.json(await service.cancel(sessionFrom(request), invitationId, request.requestId));
  });
  router.post(
    '/first-enrollment/:requestId/approve',
    sensitiveOperation,
    async (request, response) => {
      parse(z.object({}).strict(), request.body ?? {});
      const requestId = parse(z.uuid(), request.params.requestId);
      response.json(
        await service.approveFirstEnrollment(sessionFrom(request), requestId, request.requestId),
      );
    },
  );
  return router;
};
