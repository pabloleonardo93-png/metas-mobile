import { Router, type RequestHandler } from 'express';
import { z } from 'zod';

import type { AdminBffConfig } from '../config.js';
import { BffError } from '../errors.js';
import { readSessionToken } from '../http/cookies.js';
import type { MetasApiClient, MetasApiPath } from '../upstream/metasApiClient.js';
import {
  platformAdminAccessListSchema,
  platformAdminAccessMutationSchema,
  platformAdminInvitationInputSchema,
} from './platformAdminAccess.contracts.js';

const parse = <T extends z.ZodType>(schema: T, value: unknown, upstream = false): z.output<T> => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BffError(
      upstream ? 502 : 422,
      upstream ? 'UPSTREAM_INVALID_RESPONSE' : 'INVALID_INPUT',
      upstream ? 'Resposta inválida do serviço.' : 'Revise os dados informados.',
    );
  return result.data;
};

export const createPlatformAdminAccessRouter = (
  config: AdminBffConfig,
  client: MetasApiClient,
  csrf: RequestHandler,
): Router => {
  const router = Router();
  const session = (cookie: string | undefined) => readSessionToken(cookie, config);
  router.use((request, _response, next) => {
    if (!session(request.get('cookie'))) {
      next(new BffError(401, 'UNAUTHORIZED', 'Autenticação administrativa necessária.'));
      return;
    }
    next();
  });
  router.get('/', async (request, response) => {
    const result = await client.request({
      method: 'GET',
      path: '/v1/platform-admin/administrators',
      requestId: request.requestId,
      sessionToken: session(request.get('cookie'))!,
    });
    response.json(parse(platformAdminAccessListSchema, result, true));
  });
  router.post('/', csrf, async (request, response) => {
    const body = parse(platformAdminInvitationInputSchema, request.body);
    const result = await client.request({
      method: 'POST',
      path: '/v1/platform-admin/administrators',
      body,
      requestId: request.requestId,
      sessionToken: session(request.get('cookie'))!,
    });
    response.status(201).json(parse(platformAdminAccessMutationSchema, result, true));
  });
  const operations = [
    { route: '/:invitationId/cancel', parameter: 'invitationId', suffix: 'cancel' },
    { route: '/first-enrollment/:requestId/approve', parameter: 'requestId', suffix: 'approve' },
  ] as const;
  for (const operation of operations)
    router.post(operation.route, csrf, async (request, response) => {
      parse(z.object({}).strict(), request.body ?? {});
      const id = parse(z.uuid(), request.params[operation.parameter]);
      const path =
        operation.suffix === 'cancel'
          ? `/v1/platform-admin/administrators/${id}/cancel`
          : `/v1/platform-admin/administrators/first-enrollment/${id}/approve`;
      const result = await client.request({
        method: 'POST',
        path: path as MetasApiPath,
        body: {},
        requestId: request.requestId,
        sessionToken: session(request.get('cookie'))!,
      });
      response.json(parse(platformAdminAccessMutationSchema, result, true));
    });
  return router;
};
