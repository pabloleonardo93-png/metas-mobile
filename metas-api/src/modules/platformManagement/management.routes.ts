import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/AppError.js';
import { createAuthenticatePlatformAdminSession } from '../platformAdmin/authenticatePlatformAdminSession.js';
import type { PlatformAdminRateLimiter } from '../platformAdmin/platformAdminRateLimiter.js';
import { createPlatformAdminSensitiveOperation } from '../platformAdmin/platformAdminSensitiveOperation.js';
import type { PlatformAdminAuthenticationService } from '../platformAdmin/platformAdmin.types.js';
import {
  employeeCreateInputSchema,
  employeeDeleteInputSchema,
  employeeInputSchema,
  linkInputSchema,
  listInputSchema,
  pharmacyInputSchema,
  resourceSchema,
} from './management.contracts.js';
import type { ManagementService } from './management.service.js';

const parseInput = <T extends z.ZodType>(schema: T, input: unknown): z.output<T> => {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError(422, 'INVALID_INPUT', 'Revise os dados informados.');
  return result.data;
};

export const createManagementRouter = (
  authentication: PlatformAdminAuthenticationService,
  service: ManagementService,
  rateLimiter: PlatformAdminRateLimiter,
  stepUpTtlSeconds: number,
): Router => {
  const router = Router();
  router.use(createAuthenticatePlatformAdminSession(authentication));
  router.use((request, response, next) => {
    response.setHeader('cache-control', 'no-store');
    if (request.platformAdminSession?.assuranceLevel !== 'MFA_VERIFIED') {
      next(
        new AppError(403, 'MANAGEMENT_MFA_REQUIRED', 'Verifique sua passkey antes de continuar.'),
      );
      return;
    }
    next();
  });
  router.get('/:resource', async (request, response) => {
    const resource = parseInput(resourceSchema, request.params.resource);
    const filters = parseInput(listInputSchema, request.query);
    response.json(await service.list(request.platformAdminSession!, resource, filters));
  });
  router.post('/pharmacies', async (request, response) => {
    const input = parseInput(pharmacyInputSchema.omit({ version: true }), request.body);
    response
      .status(201)
      .json(
        await service.write(
          request.platformAdminSession!,
          'savePharmacy',
          null,
          input,
          request.requestId,
        ),
      );
  });
  router.post('/pharmacies/:id', async (request, response) => {
    const id = parseInput(z.uuid(), request.params.id);
    const input = parseInput(
      pharmacyInputSchema.extend({ version: z.number().int().positive() }),
      request.body,
    );
    response.json(
      await service.write(
        request.platformAdminSession!,
        'savePharmacy',
        id,
        input,
        request.requestId,
      ),
    );
  });
  router.post(
    '/employees',
    createPlatformAdminSensitiveOperation(rateLimiter, stepUpTtlSeconds),
    async (request, response) => {
      const input = parseInput(employeeCreateInputSchema, request.body);
      response
        .status(201)
        .json(
          await service.createEmployee(request.platformAdminSession!, input, request.requestId),
        );
    },
  );
  router.post('/employees/:id', async (request, response) => {
    const id = parseInput(z.uuid(), request.params.id);
    const input = parseInput(employeeInputSchema, request.body);
    response.json(
      await service.write(
        request.platformAdminSession!,
        'updateEmployee',
        id,
        input,
        request.requestId,
      ),
    );
  });
  router.delete(
    '/employees/:id',
    createPlatformAdminSensitiveOperation(rateLimiter, stepUpTtlSeconds),
    async (request, response) => {
      const id = parseInput(z.uuid(), request.params.id);
      const input = parseInput(employeeDeleteInputSchema, request.body);
      response.json(
        await service.deleteEmployee(request.platformAdminSession!, id, input, request.requestId),
      );
    },
  );
  router.post('/employees/:id/link', async (request, response) => {
    const id = parseInput(z.uuid(), request.params.id);
    const input = parseInput(linkInputSchema, request.body);
    response
      .status(201)
      .json(
        await service.write(
          request.platformAdminSession!,
          'linkEmployee',
          id,
          input,
          request.requestId,
        ),
      );
  });
  return router;
};
