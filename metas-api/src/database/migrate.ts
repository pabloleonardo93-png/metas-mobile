import {
  createDatabaseFromParameters,
  createDatabaseFromUrl,
  disconnectDatabase,
} from '../config/database.js';
import {
  loadMigrationDatabaseEnv,
  loadNorthflankMigrationDatabaseEnv,
  loadTestDatabaseEnv,
} from '../config/env.js';
import { logger } from '../shared/logging/logger.js';
import { assertMigrationConnectionSecurity } from './connectionSecurity.js';
import { createMigrator } from './umzug.js';

type MigrationCommand = 'northflank-status' | 'northflank-up' | 'status' | 'test-up' | 'up';

const isMigrationCommand = (value: string | undefined): value is MigrationCommand =>
  value === 'northflank-status' ||
  value === 'northflank-up' ||
  value === 'status' ||
  value === 'test-up' ||
  value === 'up';

const run = async (): Promise<void> => {
  const command = process.argv[2];
  if (!isMigrationCommand(command)) {
    throw new Error(
      'Expected migration command: up, status, test-up, northflank-up or northflank-status.',
    );
  }

  const testEnv = command === 'test-up' ? loadTestDatabaseEnv() : null;
  if (command === 'test-up' && testEnv === null) {
    throw new Error('TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are required.');
  }
  const isNorthflank = command === 'northflank-up' || command === 'northflank-status';
  const northflankEnv = isNorthflank ? loadNorthflankMigrationDatabaseEnv() : null;
  const migrationEnv = isNorthflank
    ? null
    : command === 'test-up'
      ? testEnv
      : loadMigrationDatabaseEnv();
  if (!migrationEnv && !northflankEnv) {
    throw new Error('Migration environment is unavailable.');
  }

  const database = northflankEnv
    ? createDatabaseFromParameters(
        {
          database: northflankEnv.database,
          host: northflankEnv.host,
          password: northflankEnv.password,
          port: northflankEnv.port,
          username: northflankEnv.username,
        },
        northflankEnv.sslServerName,
      )
    : createDatabaseFromUrl(
        migrationEnv!.migrationDatabaseUrl,
        migrationEnv!.databaseSsl,
        1,
        migrationEnv!.databaseSslServerName,
      );

  try {
    await database.authenticate();
    await assertMigrationConnectionSecurity(database);
    const migrator = createMigrator(database);

    if (command === 'status' || command === 'northflank-status') {
      const [executed, pending] = await Promise.all([migrator.executed(), migrator.pending()]);
      logger.info('migration_status', {
        executed: executed.length,
        pending: pending.length,
      });
      for (const migration of executed) {
        logger.info('migration_executed', { name: migration.name });
      }
      for (const migration of pending) {
        logger.info('migration_pending', { name: migration.name });
      }
      return;
    }

    await migrator.up();
  } finally {
    await disconnectDatabase(database);
  }
};

void run().catch((error: unknown) => {
  logger.error('migration_command_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
