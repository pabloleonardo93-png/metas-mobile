import type { Sequelize, Transaction } from 'sequelize';
import { z } from 'zod';

const databaseContextSchema = z
  .object({
    employeeId: z.uuid(),
    storeId: z.uuid(),
    userId: z.uuid(),
  })
  .strict();

export interface DatabaseContext {
  employeeId: string;
  storeId: string;
  userId: string;
}

export const withDatabaseContext = async <Result>(
  database: Sequelize,
  context: DatabaseContext,
  callback: (transaction: Transaction) => Promise<Result>,
): Promise<Result> => {
  const validatedContext = databaseContextSchema.parse(context);

  return database.transaction(async (transaction) => {
    await database.query(
      `SELECT
        set_config('app.current_user_id', :userId, TRUE),
        set_config('app.current_employee_id', :employeeId, TRUE),
        set_config('app.current_store_id', :storeId, TRUE)`,
      {
        replacements: validatedContext,
        transaction,
      },
    );

    return callback(transaction);
  });
};
