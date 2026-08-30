import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';

import { AppError } from '../../shared/errors/AppError.js';
import type { Logger } from '../../shared/logging/logger.js';
import { noopRealtimePublisher, type RealtimePublisher } from '../../realtime/realtime.types.js';
import { createAuthenticateSession } from '../auth/authenticateSession.js';
import type { AuthenticatedSession, AuthenticationService } from '../auth/auth.types.js';
import type { CampaignService } from './campaign.types.js';

const MAX_MONEY_CENTS = 9_007_199_254_740_991n;
const MONEY_CENTS_PATTERN = /^[1-9]\d{0,15}$/;
const campaignIdSchema = z.uuid();
const centsSchema = z
  .string()
  .regex(MONEY_CENTS_PATTERN)
  .refine((value) => !MONEY_CENTS_PATTERN.test(value) || BigInt(value) <= MAX_MONEY_CENTS);
const campaignMutationFields = {
  endDate: z.iso.date(),
  name: z.string().trim().min(2).max(120),
  startDate: z.iso.date(),
  targetAmountCents: centsSchema,
  targetQuantity: z.number().int().min(1).max(1_000_000_000).nullable(),
} as const;
const campaignMutationSchema = z
  .object(campaignMutationFields)
  .strict()
  .refine((value) => value.endDate >= value.startDate, { path: ['endDate'] });
const campaignUpdateSchema = z
  .object({ ...campaignMutationFields, expectedLockVersion: z.number().int().positive() })
  .strict()
  .refine((value) => value.endDate >= value.startDate, { path: ['endDate'] });
const closeCampaignSchema = z.object({ expectedLockVersion: z.number().int().positive() }).strict();
const campaignProgressSchema = z
  .object({
    amountCents: centsSchema,
    quantity: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  })
  .strict()
  .transform(({ amountCents, quantity }) => ({ amountCents, quantity: quantity ?? null }));

interface CampaignRouterOptions {
  authenticationService: AuthenticationService;
  campaignService: CampaignService;
  logger: Logger;
  realtimePublisher?: RealtimePublisher;
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

const requireManagerSession = (request: Request): AuthenticatedSession => {
  const session = requireSession(request);
  if (session.role !== 'GESTOR') {
    throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para realizar esta operação.');
  }
  return session;
};

const parseCampaignId = (request: Request): string => {
  const parsed = campaignIdSchema.safeParse(request.params.campaignId);
  if (!parsed.success) {
    throw new AppError(422, 'INVALID_INPUT', 'Identificador de campanha inválido.');
  }
  return parsed.data;
};

const addReadRoutes = (
  router: Router,
  campaignService: CampaignService,
  sessionResolver: (request: Request) => AuthenticatedSession,
): void => {
  router.get(
    '/',
    asyncHandler(async (request, response) => {
      response.status(200).json(await campaignService.list(sessionResolver(request)));
    }),
  );
  router.get(
    '/:campaignId',
    asyncHandler(async (request, response) => {
      response
        .status(200)
        .json(await campaignService.getById(sessionResolver(request), parseCampaignId(request)));
    }),
  );
};

export const createCampaignRouter = ({
  authenticationService,
  campaignService,
}: CampaignRouterOptions): Router => {
  const router = Router();
  router.use(createAuthenticateSession(authenticationService));
  addReadRoutes(router, campaignService, requireSession);
  return router;
};

export const createManagerCampaignRouter = ({
  authenticationService,
  campaignService,
  logger,
  realtimePublisher = noopRealtimePublisher,
}: CampaignRouterOptions): Router => {
  const router = Router();
  router.use(createAuthenticateSession(authenticationService));
  addReadRoutes(router, campaignService, requireManagerSession);

  router.get(
    '/:campaignId/progress',
    asyncHandler(async (request, response) => {
      response
        .status(200)
        .json(
          await campaignService.listProgress(
            requireManagerSession(request),
            parseCampaignId(request),
          ),
        );
    }),
  );

  router.post(
    '/:campaignId/progress',
    asyncHandler(async (request, response) => {
      const parsed = campaignProgressSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(422, 'INVALID_INPUT', 'Os dados do progresso são inválidos.');
      }
      const session = requireManagerSession(request);
      const result = await campaignService.createProgress(
        session,
        parseCampaignId(request),
        parsed.data,
      );
      logger.info('CAMPAIGN_PROGRESS_CREATED', {
        campaignId: result.entry.campaignId,
        requestId: request.requestId,
      });
      realtimePublisher.publish(session.storeId, 'campaigns.changed');
      response.status(201).json(result);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const parsed = campaignMutationSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(422, 'INVALID_INPUT', 'Os dados da campanha são inválidos.');
      }
      const session = requireManagerSession(request);
      const campaign = await campaignService.create(session, parsed.data);
      logger.info('CAMPAIGN_CREATED', { campaignId: campaign.id, requestId: request.requestId });
      realtimePublisher.publish(session.storeId, 'campaigns.changed');
      response.status(201).json(campaign);
    }),
  );

  router.patch(
    '/:campaignId',
    asyncHandler(async (request, response) => {
      const parsed = campaignUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(422, 'INVALID_INPUT', 'Os dados da campanha são inválidos.');
      }
      const { expectedLockVersion, ...input } = parsed.data;
      const session = requireManagerSession(request);
      const campaign = await campaignService.update(
        session,
        parseCampaignId(request),
        input,
        expectedLockVersion,
      );
      logger.info('CAMPAIGN_UPDATED', { campaignId: campaign.id, requestId: request.requestId });
      realtimePublisher.publish(session.storeId, 'campaigns.changed');
      response.status(200).json(campaign);
    }),
  );

  router.patch(
    '/:campaignId/close',
    asyncHandler(async (request, response) => {
      const parsed = closeCampaignSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(422, 'INVALID_INPUT', 'Os dados da campanha são inválidos.');
      }
      const session = requireManagerSession(request);
      const campaign = await campaignService.close(
        session,
        parseCampaignId(request),
        parsed.data.expectedLockVersion,
      );
      logger.info('CAMPAIGN_CLOSED', { campaignId: campaign.id, requestId: request.requestId });
      realtimePublisher.publish(session.storeId, 'campaigns.changed');
      response.status(200).json(campaign);
    }),
  );

  return router;
};
