import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';

import { AppError } from '../../shared/errors/AppError.js';
import type { Logger } from '../../shared/logging/logger.js';
import { noopRealtimePublisher, type RealtimePublisher } from '../../realtime/realtime.types.js';
import { createAuthenticateSession } from '../auth/authenticateSession.js';
import type { AuthenticatedSession, AuthenticationService } from '../auth/auth.types.js';
import type { EmployeeService } from './employee.types.js';

const employeeRoleSchema = z.enum(['GESTOR', 'BALCONISTA', 'CAIXA', 'FARMACEUTICO']);
const employeeStatusSchema = z.enum(['ATIVO', 'INATIVO']);
const employeeIdSchema = z.uuid();
const joinedOnSchema = z.iso
  .date()
  .refine((value) => value <= new Date().toISOString().slice(0, 10));
const employeeMutationSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
    joinedOn: joinedOnSchema,
    name: z.string().trim().min(3).max(120),
    role: employeeRoleSchema,
    status: employeeStatusSchema,
  })
  .strict();
const employeeStatusBodySchema = z.object({ status: employeeStatusSchema }).strict();
const employeeAccessEmailBodySchema = z
  .object({ email: z.string().trim().toLowerCase().pipe(z.email().max(320)) })
  .strict();

interface EmployeeRouterOptions {
  authenticationService: AuthenticationService;
  employeeService: EmployeeService;
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

const parseEmployeeId = (request: Request): string => {
  const parsed = employeeIdSchema.safeParse(request.params.employeeId);
  if (!parsed.success) {
    throw new AppError(422, 'INVALID_INPUT', 'Identificador de funcionário inválido.');
  }
  return parsed.data;
};

export const createEmployeeRouter = ({
  authenticationService,
  employeeService,
  logger,
  realtimePublisher = noopRealtimePublisher,
}: EmployeeRouterOptions): Router => {
  const router = Router();
  const authenticateSession = createAuthenticateSession(authenticationService);

  router.use(authenticateSession);

  router.get(
    '/',
    asyncHandler(async (request, response) => {
      response.status(200).json(await employeeService.list(requireSession(request)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (request, response) => {
      const parsed = employeeMutationSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(422, 'INVALID_INPUT', 'Os dados do funcionário são inválidos.');
      }
      const session = requireSession(request);
      const employee = await employeeService.create(session, parsed.data);
      logger.info('EMPLOYEE_CREATED', { employeeId: employee.id, requestId: request.requestId });
      realtimePublisher.publish(session.storeId, 'employees.changed');
      response.status(201).json(employee);
    }),
  );

  router.get(
    '/:employeeId',
    asyncHandler(async (request, response) => {
      response
        .status(200)
        .json(await employeeService.getById(requireSession(request), parseEmployeeId(request)));
    }),
  );

  router.patch(
    '/:employeeId/access-email',
    asyncHandler(async (request, response) => {
      const parsed = employeeAccessEmailBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(422, 'INVALID_INPUT', 'O e-mail de acesso informado é inválido.');
      }
      const session = requireSession(request);
      const employee = await employeeService.changeAccessEmail(
        session,
        parseEmployeeId(request),
        parsed.data,
      );
      logger.info('EMPLOYEE_ACCESS_EMAIL_CHANGED', {
        employeeId: employee.id,
        requestId: request.requestId,
      });
      realtimePublisher.publish(session.storeId, 'employees.changed');
      response.status(200).json(employee);
    }),
  );

  router.patch(
    '/:employeeId',
    asyncHandler(async (request, response) => {
      const parsed = employeeMutationSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(422, 'INVALID_INPUT', 'Os dados do funcionário são inválidos.');
      }
      const session = requireSession(request);
      const employee = await employeeService.update(session, parseEmployeeId(request), parsed.data);
      logger.info('EMPLOYEE_UPDATED', { employeeId: employee.id, requestId: request.requestId });
      realtimePublisher.publish(session.storeId, 'employees.changed');
      response.status(200).json(employee);
    }),
  );

  router.patch(
    '/:employeeId/status',
    asyncHandler(async (request, response) => {
      const parsed = employeeStatusBodySchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(422, 'INVALID_INPUT', 'O status informado é inválido.');
      }
      const session = requireSession(request);
      const employee = await employeeService.setStatus(
        session,
        parseEmployeeId(request),
        parsed.data.status,
      );
      logger.info('EMPLOYEE_STATUS_CHANGED', {
        employeeId: employee.id,
        requestId: request.requestId,
        status: employee.status,
      });
      realtimePublisher.publish(session.storeId, 'employees.changed');
      response.status(200).json(employee);
    }),
  );

  return router;
};
