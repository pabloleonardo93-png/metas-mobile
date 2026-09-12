import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AdminBffConfig } from '../config.js';
import { BffError } from '../errors.js';
import { readSessionToken } from '../http/cookies.js';
import type { MetasApiClient, MetasApiPath } from '../upstream/metasApiClient.js';
import {
  auditSchema,
  employeeCreateInputSchema,
  employeeDeleteInputSchema,
  employeeInputSchema,
  employeeSchema,
  linkInputSchema,
  listInputSchema,
  mutationResultSchema,
  pageSchema,
  pharmacyInputSchema,
  pharmacySchema,
  resourceSchema,
} from './management.contracts.js';

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
export const createManagementRouter = (
  config: AdminBffConfig,
  client: MetasApiClient,
  csrf: RequestHandler,
): Router => {
  const router = Router();
  router.use((request, _response, next) => {
    if (!readSessionToken(request.get('cookie'), config)) {
      next(new BffError(401, 'UNAUTHORIZED', 'Autenticação administrativa necessária.'));
      return;
    }
    next();
  });
  router.get('/:resource', async (request, response) => {
    const resource = parse(resourceSchema, request.params.resource);
    const filters = parse(listInputSchema, request.query);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) query.set(key, String(value));
    const result = await client.request({
      method: 'GET',
      path: `/v1/platform-admin/management/${resource}?${query.toString()}`,
      requestId: request.requestId,
      sessionToken: readSessionToken(request.get('cookie'), config)!,
    });
    const schema =
      resource === 'pharmacies'
        ? pageSchema(pharmacySchema)
        : resource === 'employees'
          ? pageSchema(employeeSchema)
          : pageSchema(auditSchema);
    response.json(parse(schema, result, true));
  });
  router.delete('/employees/:id', csrf, async (request, response) => {
    const id = parse(z.uuid(), request.params.id);
    const input = parse(employeeDeleteInputSchema, request.body);
    const result = await client.request({
      method: 'DELETE',
      path: `/v1/platform-admin/management/employees/${id}`,
      body: input,
      requestId: request.requestId,
      sessionToken: readSessionToken(request.get('cookie'), config)!,
    });
    response.json(parse(mutationResultSchema, result, true));
  });
  const writes = [
    {
      route: '/pharmacies',
      kind: 'pharmacies',
      schema: pharmacyInputSchema.omit({ version: true }),
      created: true,
    },
    {
      route: '/employees',
      kind: 'employees',
      schema: employeeCreateInputSchema,
      created: true,
    },
    {
      route: '/pharmacies/:id',
      kind: 'pharmacies',
      schema: pharmacyInputSchema.extend({ version: z.number().int().positive() }),
      created: false,
    },
    { route: '/employees/:id', kind: 'employees', schema: employeeInputSchema, created: false },
    { route: '/employees/:id/link', kind: 'employees', schema: linkInputSchema, created: true },
  ] as const;
  for (const entry of writes) {
    router.post(entry.route, csrf, async (request, response) => {
      const input = parse(entry.schema, request.body);
      const id = entry.route.includes(':id') ? parse(z.uuid(), request.params.id) : null;
      const suffix = entry.route.endsWith('/link') ? '/link' : '';
      const path =
        `/v1/platform-admin/management/${entry.kind}${id ? '/' + id : ''}${suffix}` as MetasApiPath;
      const result = await client.request({
        method: 'POST',
        path,
        body: input,
        requestId: request.requestId,
        sessionToken: readSessionToken(request.get('cookie'), config)!,
      });
      response.status(entry.created ? 201 : 200).json(parse(mutationResultSchema, result, true));
    });
  }
  return router;
};
