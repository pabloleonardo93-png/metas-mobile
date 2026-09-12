import { QueryTypes, type Sequelize } from 'sequelize';
import type { z } from 'zod';
import { withPlatformAdminDatabaseContext } from '../../shared/database/withPlatformAdminDatabaseContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { PlatformAdminSession } from '../platformAdmin/platformAdmin.types.js';
import {
  auditSchema,
  employeeSchema,
  pharmacySchema,
  pageSchema,
  type employeeCreateInputSchema,
  type employeeDeleteInputSchema,
  type ListInput,
  type ManagementResource,
} from './management.contracts.js';

export type ManagementOperation = 'savePharmacy' | 'updateEmployee' | 'linkEmployee';
export interface ManagementService {
  list(
    session: PlatformAdminSession,
    resource: ManagementResource,
    filters: ListInput,
  ): Promise<unknown>;
  createEmployee(
    session: PlatformAdminSession,
    input: z.output<typeof employeeCreateInputSchema>,
    requestId: string,
  ): Promise<{ id: string }>;
  deleteEmployee(
    session: PlatformAdminSession,
    employeeId: string,
    input: z.output<typeof employeeDeleteInputSchema>,
    requestId: string,
  ): Promise<{ id: string }>;
  write(
    session: PlatformAdminSession,
    operation: ManagementOperation,
    id: string | null,
    input: unknown,
    requestId: string,
  ): Promise<{ id: string }>;
}
const errors: Readonly<Record<string, [number, string]>> = {
  MANAGEMENT_FORBIDDEN: [403, 'Operação não autorizada.'],
  MANAGEMENT_MFA_REQUIRED: [403, 'Verifique sua passkey antes de continuar.'],
  PLATFORM_ADMIN_CONTEXT_REQUIRED: [401, 'Sua sessão expirou. Entre novamente.'],
  MANAGEMENT_INVALID_INPUT: [422, 'Revise os dados informados.'],
  MANAGEMENT_NOT_FOUND: [404, 'Registro não encontrado.'],
  MANAGEMENT_VERSION_CONFLICT: [409, 'Este registro mudou. Atualize a lista e tente novamente.'],
  LAST_ACTIVE_MANAGER_REQUIRED: [409, 'A farmácia precisa manter ao menos um gestor ativo.'],
  FIRST_EMPLOYEE_MUST_BE_BOOTSTRAP_MANAGER: [
    409,
    'O primeiro vínculo da farmácia deve ser um gestor ativo.',
  ],
  MANAGEMENT_STORE_INACTIVE: [409, 'Selecione uma farmácia ativa.'],
  MANAGEMENT_LINK_EXISTS: [
    409,
    'Esta pessoa já possui vínculo com a farmácia. Edite o vínculo existente.',
  ],
  MANAGEMENT_EMPLOYEE_EMAIL_EXISTS: [409, 'Já existe uma pessoa cadastrada com este e-mail.'],
  MANAGEMENT_MULTIPLE_STORES_UNSUPPORTED: [
    409,
    'Esta pessoa já está vinculada a outra farmácia. O acesso a múltiplas farmácias ainda não está disponível.',
  ],
  MANAGEMENT_EMPLOYEE_ALREADY_DELETED: [409, 'O funcionário já foi excluído.'],
  LAST_ACTIVE_MANAGER_DELETE_REQUIRED: [
    409,
    'Não é possível excluir o único gestor ativo desta farmácia.',
  ],
  PLATFORM_ADMIN_STEP_UP_REQUIRED: [403, 'Confirme sua identidade novamente para continuar.'],
};
export const managementError = (error: unknown): AppError => {
  const parent = error && typeof error === 'object' && 'parent' in error ? error.parent : null;
  const details = parent && typeof parent === 'object' ? parent : error;
  const message =
    details && typeof details === 'object' && 'message' in details ? details.message : null;
  if (typeof message === 'string' && Object.hasOwn(errors, message)) {
    const [status, safeMessage] = errors[message]!;
    return new AppError(status, message, safeMessage);
  }
  if (details && typeof details === 'object' && 'code' in details && details.code === '23505') {
    return new AppError(
      409,
      'MANAGEMENT_DUPLICATE',
      'Já existe um registro com esse identificador.',
    );
  }
  return new AppError(
    503,
    'MANAGEMENT_UNAVAILABLE',
    'Não foi possível concluir a operação. Tente novamente.',
  );
};
export class PostgresManagementService implements ManagementService {
  public constructor(
    private readonly database: Sequelize,
    private readonly stepUpTtlSeconds = 300,
  ) {}
  public async createEmployee(
    session: PlatformAdminSession,
    input: z.output<typeof employeeCreateInputSchema>,
    requestId: string,
  ): Promise<{ id: string }> {
    try {
      return await withPlatformAdminDatabaseContext(
        this.database,
        { platformAdminId: session.platformAdminId, sessionId: session.sessionId },
        async (transaction) => {
          const rows = await this.database.query<{ id: string }>(
            `SELECT metas.create_platform_employee(
              :name, :email, CAST(:storeId AS UUID), :role,
              :minimumStepUpAt, CAST(:requestId AS UUID)
            ) AS id`,
            {
              replacements: {
                ...input,
                minimumStepUpAt: new Date(Date.now() - this.stepUpTtlSeconds * 1000),
                requestId,
              },
              type: QueryTypes.SELECT,
              transaction,
            },
          );
          if (!rows[0]?.id) throw new Error('MANAGEMENT_UNAVAILABLE');
          return { id: rows[0].id };
        },
      );
    } catch (error) {
      throw managementError(error);
    }
  }
  public async deleteEmployee(
    session: PlatformAdminSession,
    employeeId: string,
    input: z.output<typeof employeeDeleteInputSchema>,
    requestId: string,
  ): Promise<{ id: string }> {
    try {
      return await withPlatformAdminDatabaseContext(
        this.database,
        { platformAdminId: session.platformAdminId, sessionId: session.sessionId },
        async (transaction) => {
          const rows = await this.database.query<{ id: string }>(
            `SELECT metas.delete_platform_employee(
              CAST(:employeeId AS UUID), :version, :userVersion,
              :minimumStepUpAt, CAST(:requestId AS UUID)
            ) AS id`,
            {
              replacements: {
                employeeId,
                ...input,
                minimumStepUpAt: new Date(Date.now() - this.stepUpTtlSeconds * 1000),
                requestId,
              },
              type: QueryTypes.SELECT,
              transaction,
            },
          );
          if (!rows[0]?.id) throw new Error('MANAGEMENT_UNAVAILABLE');
          return { id: rows[0].id };
        },
      );
    } catch (error) {
      throw managementError(error);
    }
  }
  public async list(
    session: PlatformAdminSession,
    resource: ManagementResource,
    filters: ListInput,
  ): Promise<unknown> {
    try {
      return await withPlatformAdminDatabaseContext(
        this.database,
        { platformAdminId: session.platformAdminId, sessionId: session.sessionId },
        async (transaction) => {
          const rows = await this.database.query<{ result: unknown }>(
            'SELECT metas.read_platform_directory(:resource, CAST(:filters AS JSONB)) AS result',
            {
              replacements: { resource, filters: JSON.stringify(filters) },
              type: QueryTypes.SELECT,
              transaction,
            },
          );
          const schema =
            resource === 'pharmacies'
              ? pageSchema(pharmacySchema)
              : resource === 'employees'
                ? pageSchema(employeeSchema)
                : pageSchema(auditSchema);
          return schema.parse(rows[0]?.result);
        },
      );
    } catch (error) {
      throw managementError(error);
    }
  }
  public async write(
    session: PlatformAdminSession,
    operation: ManagementOperation,
    id: string | null,
    input: unknown,
    requestId: string,
  ): Promise<{ id: string }> {
    try {
      return await withPlatformAdminDatabaseContext(
        this.database,
        { platformAdminId: session.platformAdminId, sessionId: session.sessionId },
        async (transaction) => {
          const rows = await this.database.query<{ id: string }>(
            'SELECT metas.write_platform_directory(:operation, CAST(:id AS UUID), CAST(:input AS JSONB), CAST(:requestId AS UUID)) AS id',
            {
              replacements: { operation, id, input: JSON.stringify(input), requestId },
              type: QueryTypes.SELECT,
              transaction,
            },
          );
          if (!rows[0]?.id) throw new Error('MANAGEMENT_UNAVAILABLE');
          return { id: rows[0].id };
        },
      );
    } catch (error) {
      throw managementError(error);
    }
  }
}
