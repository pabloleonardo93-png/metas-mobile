import { QueryTypes } from 'sequelize';

import { createDatabaseFromParameters, disconnectDatabase } from '../../config/database.js';
import { loadNorthflankAdminDatabaseEnv } from '../../config/env.js';
import { logger } from '../../shared/logging/logger.js';
import { databaseRoles } from '../roles.js';

interface RoleStatus {
  bypassRls: boolean;
  canCreateDatabase: boolean;
  canCreateRole: boolean;
  canLogin: boolean;
  canReplicate: boolean;
  isSuperuser: boolean;
  roleName: string;
}

interface RoleMembership {
  adminOption: boolean;
  inheritOption: boolean;
  memberName: string;
  roleName: string;
  setOption: boolean;
}

interface RuntimeCreatePrivileges {
  canCreateDatabaseObjects: boolean;
  canCreateInPublicSchema: boolean;
}

interface CurrentConnectionPrivileges {
  bypassRls: boolean;
  canCreateDatabase: boolean;
  canCreateRole: boolean;
  canReplicate: boolean;
  isSuperuser: boolean;
  ownsDatabase: boolean;
  ownsPublicSchema: boolean;
  requiredExtensionsAvailable: boolean;
}

const inspectRoles = async (): Promise<void> => {
  const env = loadNorthflankAdminDatabaseEnv();
  const database = createDatabaseFromParameters(
    {
      database: env.database,
      host: env.host,
      password: env.password,
      port: env.port,
      username: env.username,
    },
    env.sslServerName,
  );

  try {
    const currentConnection = await database.query<CurrentConnectionPrivileges>(
      `SELECT
        rolsuper AS "isSuperuser",
        rolcreatedb AS "canCreateDatabase",
        rolcreaterole AS "canCreateRole",
        rolreplication AS "canReplicate",
        rolbypassrls AS "bypassRls",
        (SELECT datdba = role.oid FROM pg_database WHERE datname = current_database())
          AS "ownsDatabase",
        (SELECT nspowner = role.oid FROM pg_namespace WHERE nspname = 'public')
          AS "ownsPublicSchema",
        (SELECT count(*) = 2 FROM pg_available_extensions
          WHERE name IN ('citext', 'btree_gist')) AS "requiredExtensionsAvailable"
       FROM pg_roles role
       WHERE role.rolname = current_user`,
      { type: QueryTypes.SELECT },
    );
    const roles = await database.query<RoleStatus>(
      `SELECT
        rolname AS "roleName",
        rolsuper AS "isSuperuser",
        rolcreatedb AS "canCreateDatabase",
        rolcreaterole AS "canCreateRole",
        rolcanlogin AS "canLogin",
        rolreplication AS "canReplicate",
        rolbypassrls AS "bypassRls"
       FROM pg_roles
       WHERE rolname IN (
         :migrationOwner, :migrationRunner, :platformAdminRuntime, :runtime
       )
       ORDER BY rolname`,
      {
        replacements: databaseRoles,
        type: QueryTypes.SELECT,
      },
    );
    const memberships = await database.query<RoleMembership>(
      `SELECT
         member.rolname AS "memberName",
         parent.rolname AS "roleName",
         membership.admin_option AS "adminOption",
         membership.inherit_option AS "inheritOption",
         membership.set_option AS "setOption"
       FROM pg_auth_members membership
       JOIN pg_roles member ON member.oid = membership.member
       JOIN pg_roles parent ON parent.oid = membership.roleid
       WHERE member.rolname IN (
         :migrationOwner, :migrationRunner, :platformAdminRuntime, :runtime
       )
          OR parent.rolname IN (
            :migrationOwner, :migrationRunner, :platformAdminRuntime, :runtime
          )
       ORDER BY member.rolname, parent.rolname`,
      {
        replacements: databaseRoles,
        type: QueryTypes.SELECT,
      },
    );
    const runtimePrivileges = await database.query<RuntimeCreatePrivileges>(
      `SELECT
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :runtime)
          THEN has_database_privilege(:runtime, current_database(), 'CREATE')
          ELSE FALSE
        END
          AS "canCreateDatabaseObjects",
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :runtime)
          THEN has_schema_privilege(:runtime, 'public', 'CREATE')
          ELSE FALSE
        END
          AS "canCreateInPublicSchema"`,
      {
        replacements: { runtime: databaseRoles.runtime },
        type: QueryTypes.SELECT,
      },
    );

    logger.info('database_role_status', {
      currentConnection: JSON.stringify(currentConnection[0] ?? null),
      memberships: JSON.stringify(memberships),
      passwordInspection: 'not_available_from_pg_roles',
      roles: JSON.stringify(roles),
      runtimePrivileges: JSON.stringify(runtimePrivileges[0] ?? null),
    });
  } finally {
    await disconnectDatabase(database);
  }
};

void inspectRoles().catch((error: unknown) => {
  logger.error('database_role_status_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
