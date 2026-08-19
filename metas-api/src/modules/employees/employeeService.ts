import { DatabaseError, QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';

import { withDatabaseContext } from '../../shared/database/withDatabaseContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import type {
  EmployeeDto,
  EmployeeMutationInput,
  EmployeeService,
  EmployeeStatus,
} from './employee.types.js';

interface EmployeeDatabaseRow {
  email: string;
  id: string;
  joinedOn: string;
  name: string;
  role: EmployeeDto['role'];
  status: EmployeeStatus;
}

const requireManager = (session: AuthenticatedSession): void => {
  if (session.role !== 'GESTOR') {
    throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para realizar esta operação.');
  }
};

const databaseErrorContains = (error: unknown, signal: string): boolean =>
  error instanceof DatabaseError && error.parent.message.includes(signal);

const mapEmployeeDatabaseError = (error: unknown): never => {
  if (databaseErrorContains(error, 'MANAGER_ACCESS_REQUIRED')) {
    throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para realizar esta operação.');
  }
  if (databaseErrorContains(error, 'EMPLOYEE_NOT_FOUND')) {
    throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Funcionário não encontrado.');
  }
  if (databaseErrorContains(error, 'LAST_ACTIVE_MANAGER_REQUIRED')) {
    throw new AppError(
      409,
      'LAST_ACTIVE_MANAGER_REQUIRED',
      'A loja deve permanecer com pelo menos um Gestor ativo.',
    );
  }
  if (databaseErrorContains(error, 'SELF_MANAGER_ACCESS_CHANGE_FORBIDDEN')) {
    throw new AppError(
      409,
      'SELF_MANAGER_ACCESS_CHANGE_FORBIDDEN',
      'Seu próprio cargo ou status não pode ser alterado por esta operação.',
    );
  }
  if (
    error instanceof UniqueConstraintError ||
    databaseErrorContains(error, 'users_primary_email_unique') ||
    databaseErrorContains(error, 'employees_store_user_unique')
  ) {
    throw new AppError(409, 'EMPLOYEE_ALREADY_EXISTS', 'Já existe um cadastro com este e-mail.');
  }
  if (
    databaseErrorContains(error, 'INVALID_EMPLOYEE_') ||
    (error instanceof DatabaseError && (error.parent as Error & { code?: string }).code === '22023')
  ) {
    throw new AppError(422, 'INVALID_INPUT', 'Os dados do funcionário são inválidos.');
  }
  throw error;
};

const selectColumns = `
  id,
  full_name AS name,
  primary_email AS email,
  role,
  status,
  joined_on AS "joinedOn"`;

export class PostgresEmployeeService implements EmployeeService {
  public constructor(private readonly database: Sequelize) {}

  public async list(session: AuthenticatedSession): Promise<EmployeeDto[]> {
    requireManager(session);
    return this.withContext(session, async (transaction) =>
      this.database.query<EmployeeDatabaseRow>(
        `SELECT ${selectColumns} FROM metas.manager_list_employees()`,
        { transaction, type: QueryTypes.SELECT },
      ),
    );
  }

  public async getById(session: AuthenticatedSession, employeeId: string): Promise<EmployeeDto> {
    requireManager(session);
    const rows = await this.withContext(session, async (transaction) =>
      this.database.query<EmployeeDatabaseRow>(
        `SELECT ${selectColumns} FROM metas.manager_get_employee(:employeeId)`,
        { replacements: { employeeId }, transaction, type: QueryTypes.SELECT },
      ),
    );
    const employee = rows[0];
    if (!employee) {
      throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Funcionário não encontrado.');
    }
    return employee;
  }

  public async create(
    session: AuthenticatedSession,
    input: EmployeeMutationInput,
  ): Promise<EmployeeDto> {
    requireManager(session);
    return this.runMutation(session, 'manager_create_employee', input);
  }

  public async update(
    session: AuthenticatedSession,
    employeeId: string,
    input: EmployeeMutationInput,
  ): Promise<EmployeeDto> {
    requireManager(session);
    return this.runMutation(session, 'manager_update_employee', input, employeeId);
  }

  public async setStatus(
    session: AuthenticatedSession,
    employeeId: string,
    status: EmployeeStatus,
  ): Promise<EmployeeDto> {
    requireManager(session);
    try {
      const rows = await this.withContext(session, async (transaction) =>
        this.database.query<EmployeeDatabaseRow>(
          `SELECT ${selectColumns}
           FROM metas.manager_set_employee_status(:employeeId, :status)`,
          {
            replacements: { employeeId, status },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      const employee = rows[0];
      if (!employee) {
        throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Funcionário não encontrado.');
      }
      return employee;
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      return mapEmployeeDatabaseError(error);
    }
  }

  private async runMutation(
    session: AuthenticatedSession,
    functionName: 'manager_create_employee' | 'manager_update_employee',
    input: EmployeeMutationInput,
    employeeId?: string,
  ): Promise<EmployeeDto> {
    try {
      const rows = await this.withContext(session, async (transaction) =>
        this.database.query<EmployeeDatabaseRow>(
          `SELECT ${selectColumns}
           FROM metas.${functionName}(
             ${employeeId ? ':employeeId, ' : ''}:name, :email, :role, :status, :joinedOn
           )`,
          {
            replacements: { ...input, ...(employeeId ? { employeeId } : {}) },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      const employee = rows[0];
      if (!employee) {
        throw new AppError(500, 'INTERNAL_ERROR', 'Ocorreu um erro interno.');
      }
      return employee;
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      return mapEmployeeDatabaseError(error);
    }
  }

  private withContext<Result>(
    session: AuthenticatedSession,
    callback: Parameters<typeof withDatabaseContext<Result>>[2],
  ): Promise<Result> {
    return withDatabaseContext(
      this.database,
      {
        employeeId: session.employeeId,
        storeId: session.storeId,
        userId: session.userId,
      },
      callback,
    );
  }
}
