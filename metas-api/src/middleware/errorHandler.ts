import type { ErrorRequestHandler } from 'express';

import { AppError } from '../shared/errors/AppError.js';
import type { LogContext, Logger } from '../shared/logging/logger.js';

interface ErrorWithHttpMetadata extends Error {
  status?: unknown;
  type?: unknown;
}

const isPayloadTooLarge = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const httpError = error as ErrorWithHttpMetadata;
  return httpError.status === 413 || httpError.type === 'entity.too.large';
};

const isMalformedJson = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const httpError = error as ErrorWithHttpMetadata;
  return httpError.status === 400 && httpError.type === 'entity.parse.failed';
};

const readStringProperty = (value: unknown, property: string): string | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const propertyValue: unknown = (value as Record<string, unknown>)[property];
  return typeof propertyValue === 'string' ? propertyValue : undefined;
};

const getDatabaseErrorMetadata = (error: unknown): LogContext => {
  const parent: unknown =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>).parent
      : undefined;

  return {
    databaseCode: readStringProperty(parent, 'code') ?? null,
    databaseConstraint: readStringProperty(parent, 'constraint') ?? null,
    databaseRoutine: readStringProperty(parent, 'routine') ?? null,
  };
};

export const createErrorHandler =
  (logger: Logger): ErrorRequestHandler =>
  (error: unknown, request, response, _next) => {
    void _next;

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

    if (error instanceof AppError) {
      response.status(error.statusCode).json({
        code: error.code,
        message: error.message,
        requestId: request.requestId,
      });
      return;
    }

    logger.error('http_request_failed', {
      requestId: request.requestId,
      errorType: error instanceof Error ? error.name : 'UnknownError',
      ...getDatabaseErrorMetadata(error),
    });

    response.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Ocorreu um erro interno.',
      requestId: request.requestId,
    });
  };
