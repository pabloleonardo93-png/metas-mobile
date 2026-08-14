import type { RequestHandler } from 'express';

import { AppError } from '../../shared/errors/AppError.js';
import type { AuthenticationService } from './auth.types.js';

const readBearerToken = (authorization: string | undefined): string => {
  if (!authorization) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  }

  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(authorization);
  if (!match?.[1]) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  }
  return match[1];
};

export const createAuthenticateSession =
  (authenticationService: AuthenticationService): RequestHandler =>
  async (request, _response, next) => {
    try {
      const token = readBearerToken(request.header('authorization'));
      request.authSession = await authenticationService.authenticateSession(token);
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
