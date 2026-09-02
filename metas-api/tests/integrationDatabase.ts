import type { Sequelize } from 'sequelize';

import { createDatabaseFromParameters, createDatabaseFromUrl } from '../src/config/database.js';
import { loadNorthflankIntegrationTestEnv, loadTestDatabaseEnv } from '../src/config/env.js';

interface IntegrationDatabases {
  migrationDatabase: Sequelize;
  platformAdminOperatorDatabase: Sequelize;
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
      platformAdminOperatorDatabase: createDatabaseFromParameters(
        northflank.platformAdminOperator,
        northflank.platformAdminOperator.sslServerName,
        runtimePoolMax,
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
    platformAdminOperatorDatabase: createDatabaseFromUrl(
      local.platformAdminOperatorDatabaseUrl,
      local.databaseSsl,
      runtimePoolMax,
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
