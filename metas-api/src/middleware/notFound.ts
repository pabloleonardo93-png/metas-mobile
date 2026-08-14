import type { RequestHandler } from 'express';

import { AppError } from '../shared/errors/AppError.js';

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Recurso não encontrado.'));
};
