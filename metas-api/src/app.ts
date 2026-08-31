import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { createErrorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestId } from './middleware/requestId.js';
import { createRequestLogger } from './middleware/requestLogger.js';
import { createAuthRouter, type AuthRateLimitOptions } from './modules/auth/auth.routes.js';
import type { AuthenticationService } from './modules/auth/auth.types.js';
import {
  createCampaignRouter,
  createManagerCampaignRouter,
} from './modules/campaigns/campaign.routes.js';
import type { CampaignService } from './modules/campaigns/campaign.types.js';
import { createEmployeeRouter } from './modules/employees/employee.routes.js';
import type { EmployeeService } from './modules/employees/employee.types.js';
import { createGoalRouter } from './modules/goals/goal.routes.js';
import type { GoalService } from './modules/goals/goal.types.js';
import {
  createPlatformAdminRouter,
  type PlatformAdminRateLimitOptions,
} from './modules/platformAdmin/platformAdmin.routes.js';
import type { PlatformAdminAuthenticationService } from './modules/platformAdmin/platformAdmin.types.js';
import type { RealtimePublisher } from './realtime/realtime.types.js';
import { healthRouter } from './routes/health.routes.js';
import { AppError } from './shared/errors/AppError.js';
import { logger as defaultLogger, type Logger } from './shared/logging/logger.js';

export interface AppOptions {
  authRateLimit?: AuthRateLimitOptions;
  authenticationService?: AuthenticationService;
  campaignService?: CampaignService;
  corsOrigins?: readonly string[];
  employeeService?: EmployeeService;
  goalService?: GoalService;
  logger?: Logger;
  platformAdminAuthenticationService?: PlatformAdminAuthenticationService;
  platformAdminRateLimit?: PlatformAdminRateLimitOptions;
  realtimePublisher?: RealtimePublisher;
  trustProxyHops?: number;
}

export const createApp = (options: AppOptions = {}): express.Express => {
  const app = express();
  const logger = options.logger ?? defaultLogger;
  const corsOrigins = options.corsOrigins ?? [];

  app.set('trust proxy', options.trustProxyHops ?? 0);
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(createRequestLogger(logger));
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (origin === undefined || corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'Origem não autorizada.'));
      },
    }),
  );
  app.use(express.json({ limit: '64kb', strict: true }));

  app.use('/health', healthRouter);
  if (options.platformAdminAuthenticationService) {
    app.use(
      '/v1/platform-admin',
      createPlatformAdminRouter({
        authenticationService: options.platformAdminAuthenticationService,
        logger,
        ...(options.platformAdminRateLimit
          ? { rateLimitOptions: options.platformAdminRateLimit }
          : {}),
      }),
    );
  }
  if (options.authenticationService) {
    app.use(
      '/v1',
      createAuthRouter({
        authenticationService: options.authenticationService,
        logger,
        ...(options.authRateLimit ? { rateLimitOptions: options.authRateLimit } : {}),
      }),
    );
    if (options.employeeService) {
      app.use(
        '/v1/manager/employees',
        createEmployeeRouter({
          authenticationService: options.authenticationService,
          employeeService: options.employeeService,
          logger,
          ...(options.realtimePublisher ? { realtimePublisher: options.realtimePublisher } : {}),
        }),
      );
    }
    if (options.campaignService) {
      const campaignOptions = {
        authenticationService: options.authenticationService,
        campaignService: options.campaignService,
        logger,
        ...(options.realtimePublisher ? { realtimePublisher: options.realtimePublisher } : {}),
      };
      app.use('/v1/campaigns', createCampaignRouter(campaignOptions));
      app.use('/v1/manager/campaigns', createManagerCampaignRouter(campaignOptions));
    }
    if (options.goalService) {
      app.use(
        '/v1/manager/goals/configuration',
        createGoalRouter({
          authenticationService: options.authenticationService,
          goalService: options.goalService,
          logger,
          ...(options.realtimePublisher ? { realtimePublisher: options.realtimePublisher } : {}),
        }),
      );
    }
  }

  app.use(notFound);
  app.use(createErrorHandler(logger));

  return app;
};
