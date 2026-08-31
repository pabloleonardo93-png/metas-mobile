import { QueryTypes } from 'sequelize';

import {
  createDatabaseFromParameters,
  createDatabaseFromUrl,
  disconnectDatabase,
} from '../../config/database.js';
import { loadMigrationDatabaseEnv, loadNorthflankMigrationDatabaseEnv } from '../../config/env.js';
import { logger } from '../../shared/logging/logger.js';
import { assertMigrationConnectionSecurity } from '../connectionSecurity.js';
import { parsePlatformAdminBootstrapInput } from './platformAdminBootstrapInput.js';

const bootstrap = async (): Promise<void> => {
  const target = process.argv[2];
  if (target !== undefined && target !== 'northflank') {
    throw new Error('Expected no target or the explicit target northflank.');
  }

  const input = parsePlatformAdminBootstrapInput(process.env);
  const database =
    target === 'northflank'
      ? (() => {
          const env = loadNorthflankMigrationDatabaseEnv();
          return createDatabaseFromParameters(
            {
              database: env.database,
              host: env.host,
              password: env.password,
              port: env.port,
              username: env.username,
            },
            env.sslServerName,
          );
        })()
      : (() => {
          const env = loadMigrationDatabaseEnv();
          return createDatabaseFromUrl(
            env.migrationDatabaseUrl,
            env.databaseSsl,
            1,
            env.databaseSslServerName,
          );
        })();

  try {
    await database.authenticate();
    await assertMigrationConnectionSecurity(database);
    const rows = await database.query<{ created: boolean; platformAdminId: string }>(
      `SELECT
        platform_admin_id AS "platformAdminId",
        created
       FROM metas.bootstrap_platform_admin(:displayName, :primaryEmail, :googleSubject)`,
      {
        replacements: {
          displayName: input.displayName,
          googleSubject: input.googleSubject,
          primaryEmail: input.primaryEmail,
        },
        type: QueryTypes.SELECT,
      },
    );
    const result = rows[0];
    if (!result) {
      throw new Error('Platform admin bootstrap returned no result.');
    }
    logger.info('platform_admin_bootstrap_completed', {
      created: result.created,
      platformAdminId: result.platformAdminId,
    });
  } finally {
    await disconnectDatabase(database);
  }
};

void bootstrap().catch((error: unknown) => {
  logger.error('platform_admin_bootstrap_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
