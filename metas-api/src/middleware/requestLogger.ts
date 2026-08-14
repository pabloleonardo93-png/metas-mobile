import type { RequestHandler } from 'express';

import type { Logger } from '../shared/logging/logger.js';

export const createRequestLogger =
  (logger: Logger): RequestHandler =>
  (request, response, next) => {
    const startedAt = process.hrtime.bigint();

    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const path = request.originalUrl.split('?', 1)[0] || request.path;
      logger.info('http_request_completed', {
        requestId: request.requestId,
        method: request.method,
        path,
        status: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      });
    });

    next();
  };
