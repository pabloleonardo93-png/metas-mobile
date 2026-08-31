import type { RequestHandler } from 'express';

import { AppError } from '../../shared/errors/AppError.js';
import type { PlatformAdminAuthenticationService } from './platformAdmin.types.js';

const readBearerToken = (authorization: string | undefined): string => {
  const match = authorization ? /^Bearer ([A-Za-z0-9_-]+)$/u.exec(authorization) : null;
  if (!match?.[1]) {
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticação administrativa necessária.');
  }
  return match[1];
};

export const createAuthenticatePlatformAdminSession =
  (authenticationService: PlatformAdminAuthenticationService): RequestHandler =>
  async (request, _response, next) => {
    try {
      const token = readBearerToken(request.header('authorization'));
      request.platformAdminSession = await authenticationService.authenticateSession(token);
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
