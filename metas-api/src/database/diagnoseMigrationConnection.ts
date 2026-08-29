import type { Sequelize } from 'sequelize';

import { createDatabaseFromParameters, disconnectDatabase } from '../config/database.js';
import { loadNorthflankMigrationDatabaseEnv } from '../config/env.js';
import { assertMigrationConnectionSecurity } from './connectionSecurity.js';
import {
  classifyMigrationConnectionError,
  successfulMigrationConnectionDiagnostic,
  type MigrationConnectionDiagnostic,
} from './migrationConnectionDiagnostic.js';

const diagnoseMigrationConnection = async (): Promise<MigrationConnectionDiagnostic> => {
  let database: Sequelize | undefined;
  let diagnostic: MigrationConnectionDiagnostic;

  try {
    const env = loadNorthflankMigrationDatabaseEnv();
    database = createDatabaseFromParameters(
      {
        database: env.database,
        host: env.host,
        password: env.password,
        port: env.port,
        username: env.username,
      },
      env.sslServerName,
    );

    await database.authenticate();
    await assertMigrationConnectionSecurity(database);
    diagnostic = successfulMigrationConnectionDiagnostic();
  } catch (error: unknown) {
    diagnostic = classifyMigrationConnectionError(error);
  } finally {
    if (database) {
      await disconnectDatabase(database).catch(() => undefined);
    }
  }

  return diagnostic;
};

void diagnoseMigrationConnection().then((diagnostic) => {
  process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
  if (diagnostic.errorType !== null) {
    process.exitCode = 1;
  }
});
