import type { Sequelize } from 'sequelize';

import { createDatabaseFromParameters, createDatabaseFromUrl } from '../src/config/database.js';
import { loadNorthflankIntegrationTestEnv, loadTestDatabaseEnv } from '../src/config/env.js';

interface IntegrationDatabases {
  migrationDatabase: Sequelize;
  platformAdminRuntimeDatabase: Sequelize;
  runtimeDatabase: Sequelize;
}

export const createIntegrationDatabases = (
  migrationPoolMax: number,
  runtimePoolMax: number,
): IntegrationDatabases | null => {
  const northflank = loadNorthflankIntegrationTestEnv();
  if (northflank) {
    return {
      migrationDatabase: createDatabaseFromParameters(
        northflank.migration,
        northflank.migration.sslServerName,
        migrationPoolMax,
      ),
      platformAdminRuntimeDatabase: createDatabaseFromParameters(
        northflank.platformAdminRuntime,
        northflank.platformAdminRuntime.sslServerName,
        runtimePoolMax,
      ),
      runtimeDatabase: createDatabaseFromParameters(
        northflank.runtime,
        northflank.runtime.sslServerName,
        runtimePoolMax,
      ),
    };
  }

  const local = loadTestDatabaseEnv();
  if (!local) {
    return null;
  }

  return {
    migrationDatabase: createDatabaseFromUrl(
      local.migrationDatabaseUrl,
      local.databaseSsl,
      migrationPoolMax,
      local.databaseSslServerName,
    ),
    platformAdminRuntimeDatabase: createDatabaseFromUrl(
      local.platformAdminRuntimeDatabaseUrl,
      local.databaseSsl,
      runtimePoolMax,
      local.databaseSslServerName,
    ),
    runtimeDatabase: createDatabaseFromUrl(
      local.runtimeDatabaseUrl,
      local.databaseSsl,
      runtimePoolMax,
      local.databaseSslServerName,
    ),
  };
};
