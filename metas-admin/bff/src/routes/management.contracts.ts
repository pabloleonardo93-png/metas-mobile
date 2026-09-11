import { z } from 'zod';

export const employeeRoles = ['GESTOR', 'BALCONISTA', 'CAIXA', 'FARMACEUTICO'] as const;
export type EmployeeRole = (typeof employeeRoles)[number];
export const resourceSchema = z.enum(['pharmacies', 'employees', 'audit']);
export type ManagementResource = z.infer<typeof resourceSchema>;
export const listInputSchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    status: z.enum(['ALL', 'ACTIVE', 'INACTIVE']).default('ALL'),
    role: z.enum(['ALL', ...employeeRoles]).default('ALL'),
    storeId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ListInput = z.infer<typeof listInputSchema>;
const name = z.string().trim().min(2).max(150);
export const pharmacyInputSchema = z
  .object({
    name,
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('pt-BR', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
    isActive: z.boolean(),
    version: z.number().int().positive().optional(),
  })
  .strict();
export const employeeInputSchema = z
  .object({
    name,
    role: z.enum(employeeRoles),
    status: z.enum(['ATIVO', 'INATIVO']),
    version: z.number().int().positive(),
    userVersion: z.number().int().positive(),
  })
  .strict();
export const employeeCreateInputSchema = z
  .object({
    name,
    email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
    storeId: z.uuid(),
    role: z.enum(employeeRoles),
  })
  .strict();
export const linkInputSchema = z
  .object({
    storeId: z.uuid(),
    role: z.enum(employeeRoles),
  })
  .strict();
export const mutationResultSchema = z.object({ id: z.uuid() });
export const pharmacySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  isActive: z.boolean(),
  version: z.number().int(),
  employeeCount: z.number().int(),
  managers: z.array(z.string()),
  updatedAt: z.string(),
});
export const employeeSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  storeId: z.uuid(),
  storeName: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(employeeRoles),
  status: z.enum(['ATIVO', 'INATIVO']),
  accountStatus: z.enum(['PENDING', 'ACTIVE', 'DISABLED']),
  joinedOn: z.string(),
  endedOn: z.string().nullable(),
  version: z.number().int(),
  userVersion: z.number().int(),
  updatedAt: z.string(),
});
export const auditSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  actor: z.string(),
  targetType: z.string().nullable(),
  targetId: z.uuid().nullable(),
  outcome: z.enum(['SUCCESS', 'DENIED', 'FAILURE']),
  createdAt: z.string(),
});
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  });
export type Pharmacy = z.infer<typeof pharmacySchema>;
export type Employee = z.infer<typeof employeeSchema>;
export type AuditEvent = z.infer<typeof auditSchema>;
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
