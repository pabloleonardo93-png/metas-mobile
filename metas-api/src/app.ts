import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { createErrorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestId } from './middleware/requestId.js';
import { createRequestLogger } from './middleware/requestLogger.js';
import { createAuthRouter, type AuthRateLimitOptions } from './modules/auth/auth.routes.js';
import type { AuthenticationService } from './modules/auth/auth.types.js';
import { healthRouter } from './routes/health.routes.js';
import { AppError } from './shared/errors/AppError.js';
import { logger as defaultLogger, type Logger } from './shared/logging/logger.js';

export interface AppOptions {
  authRateLimit?: AuthRateLimitOptions;
  authenticationService?: AuthenticationService;
  corsOrigins?: readonly string[];
  logger?: Logger;
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
  if (options.authenticationService) {
    app.use(
      '/v1',
      createAuthRouter({
        authenticationService: options.authenticationService,
        logger,
        ...(options.authRateLimit ? { rateLimitOptions: options.authRateLimit } : {}),
      }),
    );
  }

  app.use(notFound);
  app.use(createErrorHandler(logger));

  return app;
};
