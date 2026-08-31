import type { Sequelize, Transaction } from 'sequelize';
import { z } from 'zod';

const platformAdminDatabaseContextSchema = z
  .object({
    platformAdminId: z.uuid(),
    sessionId: z.uuid(),
  })
  .strict();

export interface PlatformAdminDatabaseContext {
  platformAdminId: string;
  sessionId: string;
}

export const withPlatformAdminDatabaseContext = async <Result>(
  database: Sequelize,
  context: PlatformAdminDatabaseContext,
  callback: (transaction: Transaction) => Promise<Result>,
): Promise<Result> => {
  const validatedContext = platformAdminDatabaseContextSchema.parse(context);

  return database.transaction(async (transaction) => {
    await database.query(
      `SELECT
        set_config('app.current_platform_admin_id', :platformAdminId, TRUE),
        set_config('app.current_platform_admin_session_id', :sessionId, TRUE)`,
      {
        replacements: validatedContext,
        transaction,
      },
    );

    return callback(transaction);
  });
};
