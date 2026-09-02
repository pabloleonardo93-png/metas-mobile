import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import helmet from 'helmet';

import type { AdminBffConfig } from './config.js';
import { BffError } from './errors.js';
import { createAdminAuthRouter } from './routes/adminAuth.routes.js';
import { createApiHostProtection, createCsrfProtection } from './security/csrf.js';
import type { MetasApiClient } from './upstream/metasApiClient.js';

export interface BffLogger {
  error(event: string, context: Readonly<Record<string, unknown>>): void;
  info(event: string, context: Readonly<Record<string, unknown>>): void;
}

export interface CreateAppOptions {
  client: MetasApiClient;
  config: AdminBffConfig;
  logger?: BffLogger;
  staticDirectory?: string | null;
}

const defaultLogger: BffLogger = {
  error: (event, context) => console.error(JSON.stringify({ event, ...context })),
  info: (event, context) => console.info(JSON.stringify({ event, ...context })),
};

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      baseUri: ["'self'"],
      connectSrc: ["'self'", 'https://accounts.google.com/gsi/'],
      defaultSrc: ["'self'"],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      frameSrc: ['https://accounts.google.com/gsi/'],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
      styleSrc: ["'self'", 'https://accounts.google.com/gsi/style'],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  hsts: { includeSubDomains: true, maxAge: 31_536_000, preload: true },
  referrerPolicy: { policy: 'no-referrer' },
});

const apiRequestId: RequestHandler = (request, response, next) => {
  request.requestId = randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
};

const requireJsonForMutations: RequestHandler = (request, _response, next) => {
  if (request.method === 'POST' && request.is('application/json') !== 'application/json') {
    next(new BffError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie o corpo como application/json.'));
    return;
  }
  next();
};

const isMalformedJson = (error: unknown): boolean => {
  if (!(error instanceof SyntaxError)) return false;
  const details = error as SyntaxError & { status?: unknown; type?: unknown };
  return details.status === 400 && details.type === 'entity.parse.failed';
};

const isPayloadTooLarge = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const details = error as Error & { status?: unknown; type?: unknown };
  return details.status === 413 || details.type === 'entity.too.large';
};

const createErrorHandler =
  (logger: BffLogger): ErrorRequestHandler =>
  (error, request, response, _next) => {
    void _next;
    response.setHeader('cache-control', 'no-store');
    if (isPayloadTooLarge(error)) {
      response.status(413).json({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'O corpo da requisição excede o limite permitido.',
        requestId: request.requestId,
      });
      return;
    }
    if (isMalformedJson(error)) {
      response.status(400).json({
        code: 'INVALID_JSON',
        message: 'O corpo da requisição contém JSON inválido.',
        requestId: request.requestId,
      });
      return;
    }
    if (error instanceof BffError) {
      if (error.retryAfterSeconds !== undefined) {
        response.setHeader('retry-after', String(error.retryAfterSeconds));
      }
      response.status(error.statusCode).json({
        code: error.code,
        message: error.message,
        requestId: request.requestId,
      });
      return;
    }
    logger.error('admin_bff_request_failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
      requestId: request.requestId,
    });
    response.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Ocorreu um erro interno.',
      requestId: request.requestId,
    });
  };

const defaultStaticDirectory = path.resolve(import.meta.dirname, '../../frontend/dist');

export const createApp = ({
  client,
  config,
  logger = defaultLogger,
  staticDirectory = defaultStaticDirectory,
}: CreateAppOptions): express.Express => {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use((_request, response, next) => {
    response.setHeader(
      'permissions-policy',
      'camera=(), geolocation=(), microphone=(), publickey-credentials-create=(self), publickey-credentials-get=(self)',
    );
    next();
  });

  app.use('/api', apiRequestId);
  app.use('/api', (_request, response, next) => {
    response.setHeader('cache-control', 'no-store');
    next();
  });
  app.use('/api', createApiHostProtection(config));
  app.use('/api', requireJsonForMutations);
  app.use('/api', express.json({ limit: '128kb', strict: true, type: 'application/json' }));
  app.use('/api', createAdminAuthRouter(config, client, createCsrfProtection(config)));
  app.use('/api', (_request, _response, next) => {
    next(new BffError(404, 'NOT_FOUND', 'Recurso não encontrado.'));
  });

  if (staticDirectory && existsSync(staticDirectory)) {
    app.use(
      '/assets',
      express.static(path.join(staticDirectory, 'assets'), {
        dotfiles: 'deny',
        immutable: true,
        index: false,
        maxAge: '1y',
      }),
    );
    app.use(
      express.static(staticDirectory, {
        dotfiles: 'deny',
        index: false,
        maxAge: 0,
      }),
    );
    app.get(/^(?!\/api(?:\/|$)).*/u, (_request, response) => {
      response.setHeader('cache-control', 'no-store');
      response.sendFile(path.join(staticDirectory, 'index.html'));
    });
  }

  app.use(createErrorHandler(logger));
  return app;
};
