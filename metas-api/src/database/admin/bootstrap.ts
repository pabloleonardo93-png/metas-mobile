import {
  createDatabaseFromParameters,
  createDatabaseFromUrl,
  disconnectDatabase,
} from '../../config/database.js';
import { loadAdminDatabaseEnv, loadNorthflankAdminDatabaseEnv } from '../../config/env.js';
import { logger } from '../../shared/logging/logger.js';
import { applicationSchema, databaseRoles } from '../roles.js';

const createRolesSql = `
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${databaseRoles.migrationOwner}') THEN
    CREATE ROLE ${databaseRoles.migrationOwner} NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${databaseRoles.migrationRunner}') THEN
    CREATE ROLE ${databaseRoles.migrationRunner} LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${databaseRoles.runtime}') THEN
    CREATE ROLE ${databaseRoles.runtime} LOGIN;
  END IF;
END
$roles$;
`;

const roleMembershipSql = `
GRANT ${databaseRoles.migrationOwner} TO ${databaseRoles.migrationRunner};
REVOKE ${databaseRoles.migrationOwner}, ${databaseRoles.migrationRunner} FROM ${databaseRoles.runtime};
`;

const rolesBootstrapSql = `${createRolesSql}

ALTER ROLE ${databaseRoles.migrationOwner}
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE ${databaseRoles.migrationRunner}
  NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE ${databaseRoles.runtime}
  NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN NOINHERIT NOREPLICATION NOBYPASSRLS;

${roleMembershipSql}`;

const managedRolesBootstrapSql = `${createRolesSql}

GRANT ${databaseRoles.migrationOwner} TO CURRENT_USER WITH SET TRUE;

ALTER ROLE ${databaseRoles.migrationOwner}
  NOCREATEDB NOCREATEROLE NOLOGIN NOINHERIT;
ALTER ROLE ${databaseRoles.migrationRunner}
  NOCREATEDB NOCREATEROLE LOGIN NOINHERIT;
ALTER ROLE ${databaseRoles.runtime}
  NOCREATEDB NOCREATEROLE LOGIN NOINHERIT;

${roleMembershipSql}`;

const infrastructureBootstrapSql = `

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS ${applicationSchema} AUTHORIZATION ${databaseRoles.migrationOwner};
ALTER SCHEMA ${applicationSchema} OWNER TO ${databaseRoles.migrationOwner};
REVOKE CREATE ON SCHEMA ${applicationSchema} FROM PUBLIC;
REVOKE USAGE ON SCHEMA ${applicationSchema} FROM PUBLIC;
GRANT USAGE ON SCHEMA ${applicationSchema} TO ${databaseRoles.migrationRunner};
GRANT USAGE ON SCHEMA ${applicationSchema} TO ${databaseRoles.runtime};

SET ROLE ${databaseRoles.migrationOwner};
CREATE TABLE IF NOT EXISTS ${applicationSchema}.schema_migrations (
  name TEXT PRIMARY KEY,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
RESET ROLE;

REVOKE ALL ON TABLE ${applicationSchema}.schema_migrations FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON TABLE ${applicationSchema}.schema_migrations
  TO ${databaseRoles.migrationRunner};

ALTER DEFAULT PRIVILEGES FOR ROLE ${databaseRoles.migrationOwner}
  IN SCHEMA ${applicationSchema} REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ${databaseRoles.migrationOwner}
  IN SCHEMA ${applicationSchema} REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ${databaseRoles.migrationOwner}
  IN SCHEMA ${applicationSchema} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
`;

const bootstrapSql = `${rolesBootstrapSql}\n${infrastructureBootstrapSql}`;
const managedBootstrapSql = `${managedRolesBootstrapSql}\n${infrastructureBootstrapSql}`;

const bootstrap = async (): Promise<void> => {
  const requestedTarget = process.argv[2];
  if (
    requestedTarget !== undefined &&
    requestedTarget !== 'test' &&
    requestedTarget !== 'northflank' &&
    requestedTarget !== 'northflank-check' &&
    requestedTarget !== 'northflank-roles'
  ) {
    throw new Error(
      'Expected no bootstrap target or one of: test, northflank, northflank-check, northflank-roles.',
    );
  }

  const isNorthflank =
    requestedTarget === 'northflank' ||
    requestedTarget === 'northflank-check' ||
    requestedTarget === 'northflank-roles';
  const checkOnly = requestedTarget === 'northflank-check';
  const rolesOnly = requestedTarget === 'northflank-roles';
  const target = requestedTarget === 'test' ? 'test' : 'development';
  const database = isNorthflank
    ? (() => {
        const env = loadNorthflankAdminDatabaseEnv();
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
        const env = loadAdminDatabaseEnv(target);
        return createDatabaseFromUrl(
          env.adminDatabaseUrl,
          env.databaseSsl,
          1,
          env.databaseSslServerName,
        );
      })();

  try {
    await database.query('SELECT 1');
    if (checkOnly) {
      logger.info('database_admin_connection_validated');
      return;
    }
    await database.query(
      rolesOnly ? managedRolesBootstrapSql : isNorthflank ? managedBootstrapSql : bootstrapSql,
    );
    logger.info('database_admin_bootstrap_completed');
  } finally {
    await disconnectDatabase(database);
  }
};

void bootstrap().catch((error: unknown) => {
  const databaseCode =
    typeof error === 'object' &&
    error !== null &&
    'parent' in error &&
    typeof error.parent === 'object' &&
    error.parent !== null &&
    'code' in error.parent &&
    typeof error.parent.code === 'string'
      ? error.parent.code
      : 'unavailable';
  logger.error('database_admin_bootstrap_failed', {
    databaseCode,
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
