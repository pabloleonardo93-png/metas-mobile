import type { Sequelize, Transaction } from 'sequelize';

import { databaseRoles } from '../roles.js';

export const runMigration = async (database: Sequelize, sql: string): Promise<void> => {
  await database.transaction(async (transaction: Transaction) => {
    await database.query(`SET LOCAL ROLE ${databaseRoles.migrationOwner}`, { transaction });
    await database.query(sql, { transaction });
  });
};
