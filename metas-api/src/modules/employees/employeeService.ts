import {
  DatabaseError,
  QueryTypes,
  UniqueConstraintError,
  type Sequelize,
  type Transaction,
} from 'sequelize';

import { withDatabaseContext } from '../../shared/database/withDatabaseContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import type {
  EmployeeAccessEmailInput,
  EmployeeDto,
  EmployeeMutationInput,
  EmployeeService,
  EmployeeStatus,
} from './employee.types.js';

interface EmployeeDatabaseRow {
  email: string;
  googleLinked: boolean;
  id: string;
  joinedOn: string;
  name: string;
  role: EmployeeDto['role'];
  status: EmployeeStatus;
}

type EmployeeBaseDatabaseRow = Omit<EmployeeDatabaseRow, 'googleLinked'>;

interface EmployeeAccessStateRow {
  email: string;
  googleLinked: boolean;
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
  if (databaseErrorContains(error, 'EMPLOYEE_ACCESS_EMAIL_CHANGE_REQUIRES_EXPLICIT_RESET')) {
    throw new AppError(
      409,
      'EMPLOYEE_ACCESS_EMAIL_CHANGE_REQUIRES_EXPLICIT_RESET',
      'Use a alteração explícita do e-mail de acesso.',
    );
  }
  if (databaseErrorContains(error, 'EMPLOYEE_ACCESS_EMAIL_MULTIPLE_STORES_FORBIDDEN')) {
    throw new AppError(
      409,
      'EMPLOYEE_ACCESS_EMAIL_MULTIPLE_STORES_FORBIDDEN',
      'O acesso de um colaborador vinculado a mais de uma loja exige administração global.',
    );
  }
  if (databaseErrorContains(error, 'EMPLOYEE_ACCESS_EMAIL_UNCHANGED')) {
    throw new AppError(
      409,
      'EMPLOYEE_ACCESS_EMAIL_UNCHANGED',
      'O novo e-mail deve ser diferente do e-mail de acesso atual.',
    );
  }
  if (
    error instanceof UniqueConstraintError ||
    databaseErrorContains(error, 'EMPLOYEE_ACCESS_EMAIL_ALREADY_EXISTS') ||
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
  employee.id,
  employee.full_name AS name,
  access.access_email AS email,
  access.google_linked AS "googleLinked",
  employee.role,
  employee.status,
  employee.joined_on AS "joinedOn"`;

const selectEmployeeWithAccessState = (employeeSource: string): string => `
  WITH employee AS (${employeeSource})
  SELECT ${selectColumns}
  FROM employee
  JOIN metas.manager_list_employee_access_states() access
    ON access.employee_id = employee.id`;

const baseSelectColumns = `
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
        selectEmployeeWithAccessState('SELECT * FROM metas.manager_list_employees()'),
        { transaction, type: QueryTypes.SELECT },
      ),
    );
  }

  public async getById(session: AuthenticatedSession, employeeId: string): Promise<EmployeeDto> {
    requireManager(session);
    const rows = await this.withContext(session, async (transaction) =>
      this.database.query<EmployeeDatabaseRow>(
        selectEmployeeWithAccessState('SELECT * FROM metas.manager_get_employee(:employeeId)'),
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

  public async changeAccessEmail(
    session: AuthenticatedSession,
    employeeId: string,
    input: EmployeeAccessEmailInput,
  ): Promise<EmployeeDto> {
    requireManager(session);
    try {
      return await this.withContext(session, async (transaction) => {
        const rows = await this.database.query<EmployeeBaseDatabaseRow>(
          `SELECT ${baseSelectColumns}
           FROM metas.manager_change_employee_access_email(:employeeId, :email)`,
          {
            replacements: { email: input.email, employeeId },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        const employee = rows[0];
        if (!employee) {
          throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Funcionário não encontrado.');
        }
        return this.attachAccessState(transaction, employee);
      });
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      return mapEmployeeDatabaseError(error);
    }
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
          selectEmployeeWithAccessState(
            'SELECT * FROM metas.manager_set_employee_status(:employeeId, :status)',
          ),
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
      return await this.withContext(session, async (transaction) => {
        const rows = await this.database.query<EmployeeBaseDatabaseRow>(
          `SELECT ${baseSelectColumns}
           FROM metas.${functionName}(
             ${employeeId ? ':employeeId, ' : ''}:name, :email, :role, :status, :joinedOn
           )`,
          {
            replacements: { ...input, ...(employeeId ? { employeeId } : {}) },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        const employee = rows[0];
        if (!employee) {
          throw new AppError(500, 'INTERNAL_ERROR', 'Ocorreu um erro interno.');
        }
        return this.attachAccessState(transaction, employee);
      });
    } catch (error: unknown) {
      if (error instanceof AppError) {
        throw error;
      }
      return mapEmployeeDatabaseError(error);
    }
  }

  private async attachAccessState(
    transaction: Transaction,
    employee: EmployeeBaseDatabaseRow,
  ): Promise<EmployeeDto> {
    const rows = await this.database.query<EmployeeAccessStateRow>(
      `SELECT
         access_email AS email,
         google_linked AS "googleLinked"
       FROM metas.manager_list_employee_access_states()
       WHERE employee_id = :employeeId`,
      {
        replacements: { employeeId: employee.id },
        transaction,
        type: QueryTypes.SELECT,
      },
    );
    const access = rows[0];
    if (!access) {
      throw new AppError(404, 'EMPLOYEE_NOT_FOUND', 'Funcionário não encontrado.');
    }
    return { ...employee, ...access };
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
