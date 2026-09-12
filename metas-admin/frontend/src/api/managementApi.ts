import { z } from 'zod';
import { destructiveMutation, mutation, request } from './adminApi';
import {
  auditSchema,
  employeeSchema,
  pharmacySchema,
  pageSchema,
  mutationResultSchema,
  type ManagementResource,
  type ListInput,
} from './management.contracts';

export const managementApi = {
  async list(resource: ManagementResource, filters: Partial<ListInput>, signal?: AbortSignal) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined) query.set(key, String(value));
    const value = await request(
      `/api/management/${resource}?${query.toString()}`,
      signal ? { signal } : {},
    );
    if (resource === 'pharmacies') return pageSchema(pharmacySchema).parse(value);
    if (resource === 'employees') return pageSchema(employeeSchema).parse(value);
    return pageSchema(auditSchema).parse(value);
  },
  async save(
    resource: 'pharmacies' | 'employees',
    id: string | null,
    input: unknown,
    link = false,
  ) {
    if (id) z.uuid().parse(id);
    return mutationResultSchema.parse(
      await mutation(
        `/api/management/${resource}${id ? '/' + id : ''}${link ? '/link' : ''}`,
        input,
      ),
    );
  },
  async deleteEmployee(employeeId: string, input: { version: number; userVersion: number }) {
    z.uuid().parse(employeeId);
    return mutationResultSchema.parse(
      await destructiveMutation(`/api/management/employees/${employeeId}`, input),
    );
  },
};
