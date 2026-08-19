import { DatabaseError, QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import { withDatabaseContext } from '../../shared/database/withDatabaseContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { AuthenticatedSession } from '../auth/auth.types.js';
import type {
  GoalRoleConfigurationDto,
  GoalService,
  ManagerGoalConfigurationDto,
  SaveManagerGoalConfigurationInput,
} from './goal.types.js';

interface GoalConfigurationRow {
  employeeCountSnapshot: number;
  id: string | null;
  lockVersion: number | null;
  month: string;
  monthlyTargetCents: string;
  remainingBusinessDays: number;
  role: GoalRoleConfigurationDto['role'];
  soldAmountCents: string;
  totalBusinessDays: number;
  weight: string;
}

const requireManager = (session: AuthenticatedSession): void => {
  if (session.role !== 'GESTOR') {
    throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para realizar esta operação.');
  }
};

const databaseErrorContains = (error: unknown, signal: string): boolean =>
  error instanceof DatabaseError && error.parent.message.includes(signal);

const mapGoalDatabaseError = (error: unknown): never => {
  if (databaseErrorContains(error, 'MANAGER_ACCESS_REQUIRED')) {
    throw new AppError(403, 'FORBIDDEN', 'Você não tem permissão para realizar esta operação.');
  }
  if (databaseErrorContains(error, 'GOAL_CONFIGURATION_CONFLICT')) {
    throw new AppError(
      409,
      'GOAL_CONFIGURATION_CONFLICT',
      'A configuração foi alterada por outro Gestor. Recarregue e tente novamente.',
    );
  }
  if (databaseErrorContains(error, 'INVALID_GOAL_CONFIGURATION')) {
    throw new AppError(422, 'INVALID_INPUT', 'Os dados da configuração são inválidos.');
  }
  throw error;
};

const selectColumns = `
  goal_id AS id,
  goal_month AS month,
  monthly_target_cents AS "monthlyTargetCents",
  sold_amount_cents AS "soldAmountCents",
  remaining_business_days AS "remainingBusinessDays",
  total_business_days AS "totalBusinessDays",
  lock_version AS "lockVersion",
  role,
  employee_count_snapshot AS "employeeCountSnapshot",
  weight`;

const toConfiguration = (rows: GoalConfigurationRow[]): ManagerGoalConfigurationDto => {
  const first = rows[0];
  if (!first || rows.length !== 3) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Ocorreu um erro interno.');
  }

  return {
    id: first.id,
    lockVersion: first.lockVersion,
    month: first.month,
    monthlyTargetCents: first.monthlyTargetCents,
    remainingBusinessDays: first.remainingBusinessDays,
    roles: rows.map(({ employeeCountSnapshot, role, weight }) => ({
      employeeCountSnapshot,
      role,
      weight,
    })),
    soldAmountCents: first.soldAmountCents,
    totalBusinessDays: first.totalBusinessDays,
  };
};

export class PostgresGoalService implements GoalService {
  public constructor(private readonly database: Sequelize) {}

  public async getConfiguration(
    session: AuthenticatedSession,
  ): Promise<ManagerGoalConfigurationDto> {
    requireManager(session);
    try {
      const rows = await this.withContext(session, async (transaction) =>
        this.database.query<GoalConfigurationRow>(
          `SELECT ${selectColumns} FROM metas.manager_get_goal_configuration()`,
          { transaction, type: QueryTypes.SELECT },
        ),
      );
      return toConfiguration(rows);
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      return mapGoalDatabaseError(error);
    }
  }

  public async saveConfiguration(
    session: AuthenticatedSession,
    input: SaveManagerGoalConfigurationInput,
  ): Promise<ManagerGoalConfigurationDto> {
    requireManager(session);
    try {
      const rows = await this.withContext(session, async (transaction) =>
        this.database.query<GoalConfigurationRow>(
          `SELECT ${selectColumns}
           FROM metas.manager_save_goal_configuration(
             :monthlyTargetCents,
             :soldAmountCents,
             :remainingBusinessDays,
             :totalBusinessDays,
             CAST(:roleWeights AS jsonb),
             :expectedLockVersion
           )`,
          {
            replacements: {
              ...input,
              roleWeights: JSON.stringify(input.roleWeights),
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      return toConfiguration(rows);
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      return mapGoalDatabaseError(error);
    }
  }

  private withContext<Result>(
    session: AuthenticatedSession,
    callback: (transaction: Transaction) => Promise<Result>,
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
