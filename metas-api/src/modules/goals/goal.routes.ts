import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';

import { AppError } from '../../shared/errors/AppError.js';
import type { Logger } from '../../shared/logging/logger.js';
import { createAuthenticateSession } from '../auth/authenticateSession.js';
import type { AuthenticatedSession, AuthenticationService } from '../auth/auth.types.js';
import type { GoalService } from './goal.types.js';

const MAX_MONEY_CENTS = 9_007_199_254_740_991n;
const isValidCents = (value: string): boolean =>
  /^(0|[1-9]\d{0,15})$/.test(value) && BigInt(value) <= MAX_MONEY_CENTS;
const centsSchema = z.string().refine(isValidCents);
const positiveCentsSchema = z.string().refine((value) => isValidCents(value) && BigInt(value) > 0n);
const weightSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,2})(\.\d{1,4})?$/)
  .refine((value) => Number(value) <= 100);
const goalRoleSchema = z.enum(['BALCONISTA', 'CAIXA', 'FARMACEUTICO']);
const roleWeightSchema = z.object({ role: goalRoleSchema, weight: weightSchema }).strict();
const saveConfigurationSchema = z
  .object({
    expectedLockVersion: z.number().int().positive().nullable(),
    monthlyTargetCents: positiveCentsSchema,
    remainingBusinessDays: z.number().int().min(0).max(31),
    roleWeights: z.array(roleWeightSchema).length(3),
    soldAmountCents: centsSchema,
    totalBusinessDays: z.number().int().min(1).max(31),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.remainingBusinessDays > value.totalBusinessDays) {
      context.addIssue({ code: 'custom', message: 'remaining days exceed total days' });
    }
    if (new Set(value.roleWeights.map(({ role }) => role)).size !== 3) {
      context.addIssue({ code: 'custom', message: 'roles must be unique' });
    }
  });

interface GoalRouterOptions {
  authenticationService: AuthenticationService;
  goalService: GoalService;
  logger: Logger;
}

const asyncHandler =
  (
    handler: (request: Request, response: Parameters<RequestHandler>[1]) => Promise<void>,
  ): RequestHandler =>
  (request, response, next) => {
    void handler(request, response).catch(next);
  };

const requireSession = (request: Request): AuthenticatedSession => {
  if (!request.authSession) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  }
  return request.authSession;
};

export const createGoalRouter = ({
  authenticationService,
  goalService,
  logger,
}: GoalRouterOptions): Router => {
  const router = Router();
  router.use(createAuthenticateSession(authenticationService));

  router.get(
    '/',
    asyncHandler(async (request, response) => {
      response.status(200).json(await goalService.getConfiguration(requireSession(request)));
    }),
  );

  router.put(
    '/',
    asyncHandler(async (request, response) => {
      const parsed = saveConfigurationSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(422, 'INVALID_INPUT', 'Os dados da configuração são inválidos.');
      }
      const configuration = await goalService.saveConfiguration(
        requireSession(request),
        parsed.data,
      );
      logger.info('GOAL_CONFIGURATION_SAVED', {
        goalId: configuration.id,
        requestId: request.requestId,
      });
      response.status(200).json(configuration);
    }),
  );

  return router;
};
