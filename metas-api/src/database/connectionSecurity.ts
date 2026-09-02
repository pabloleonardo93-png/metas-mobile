import { QueryTypes, type Sequelize } from 'sequelize';

import { databaseRoles } from './roles.js';

interface ConnectionRoleSecurity {
  bypassRls: boolean;
  canCreateDatabase: boolean;
  canCreateRole: boolean;
  canReplicate: boolean;
  canLogin: boolean;
  isMemberMigrationOwner: boolean;
  isMemberMigrationRunner: boolean;
  isMemberPlatformAdminOperator: boolean;
  isMemberPlatformAdminRuntime: boolean;
  isMemberRuntime: boolean;
  isSuperuser: boolean;
  roleName: string;
}

const readConnectionRoleSecurity = async (database: Sequelize): Promise<ConnectionRoleSecurity> => {
  const rows = await database.query<ConnectionRoleSecurity>(
    `SELECT
      current_user::TEXT AS "roleName",
      role.rolsuper AS "isSuperuser",
      role.rolcreatedb AS "canCreateDatabase",
      role.rolcreaterole AS "canCreateRole",
      role.rolcanlogin AS "canLogin",
      role.rolreplication AS "canReplicate",
      role.rolbypassrls AS "bypassRls",
      pg_has_role(current_user, :runtimeRole, 'MEMBER') AS "isMemberRuntime",
      CASE
        WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :platformAdminRuntimeRole)
        THEN pg_has_role(current_user, :platformAdminRuntimeRole, 'MEMBER')
        ELSE FALSE
      END AS "isMemberPlatformAdminRuntime",
      CASE
        WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :platformAdminOperatorRole)
        THEN pg_has_role(current_user, :platformAdminOperatorRole, 'MEMBER')
        ELSE FALSE
      END AS "isMemberPlatformAdminOperator",
      pg_has_role(current_user, :migrationRunnerRole, 'MEMBER') AS "isMemberMigrationRunner",
      pg_has_role(current_user, :migrationOwnerRole, 'MEMBER') AS "isMemberMigrationOwner"
    FROM pg_roles role
    WHERE role.rolname = current_user`,
    {
      replacements: {
        runtimeRole: databaseRoles.runtime,
        platformAdminOperatorRole: databaseRoles.platformAdminOperator,
        platformAdminRuntimeRole: databaseRoles.platformAdminRuntime,
        migrationRunnerRole: databaseRoles.migrationRunner,
        migrationOwnerRole: databaseRoles.migrationOwner,
      },
      type: QueryTypes.SELECT,
    },
  );

  const security = rows[0];
  if (!security) {
    throw new Error('PostgreSQL connection role could not be inspected.');
  }
  return security;
};

const hasElevatedAttributes = (security: ConnectionRoleSecurity): boolean =>
  security.isSuperuser ||
  security.canCreateDatabase ||
  security.canCreateRole ||
  security.canReplicate ||
  security.bypassRls;

const assertDoesNotOwnApplicationObjects = async (
  database: Sequelize,
  errorMessage: string,
): Promise<void> => {
  const ownedRows = await database.query<{ count: string }>(
    `SELECT count(*)::TEXT AS count
     FROM pg_class relation
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'metas'
       AND relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`,
    { type: QueryTypes.SELECT },
  );
  if (ownedRows[0]?.count !== '0') {
    throw new Error(errorMessage);
  }
};

export const assertRuntimeConnectionSecurity = async (database: Sequelize): Promise<void> => {
  const security = await readConnectionRoleSecurity(database);
  if (
    hasElevatedAttributes(security) ||
    !security.canLogin ||
    security.roleName !== databaseRoles.runtime ||
    !security.isMemberRuntime ||
    security.isMemberPlatformAdminOperator ||
    security.isMemberPlatformAdminRuntime ||
    security.isMemberMigrationRunner ||
    security.isMemberMigrationOwner
  ) {
    throw new Error(
      'PostgreSQL runtime login does not satisfy the required least privilege policy.',
    );
  }

  await assertDoesNotOwnApplicationObjects(
    database,
    'PostgreSQL runtime login must not own application objects.',
  );
};

export const assertMigrationConnectionSecurity = async (database: Sequelize): Promise<void> => {
  const security = await readConnectionRoleSecurity(database);
  if (
    hasElevatedAttributes(security) ||
    !security.canLogin ||
    security.roleName !== databaseRoles.migrationRunner ||
    !security.isMemberMigrationRunner ||
    !security.isMemberMigrationOwner ||
    security.isMemberRuntime ||
    security.isMemberPlatformAdminOperator ||
    security.isMemberPlatformAdminRuntime
  ) {
    throw new Error(
      'PostgreSQL migration login does not satisfy the required least privilege policy.',
    );
  }
};

export const assertPlatformAdminOperatorConnectionSecurity = async (
  database: Sequelize,
): Promise<void> => {
  const security = await readConnectionRoleSecurity(database);
  if (
    hasElevatedAttributes(security) ||
    !security.canLogin ||
    security.roleName !== databaseRoles.platformAdminOperator ||
    !security.isMemberPlatformAdminOperator ||
    security.isMemberRuntime ||
    security.isMemberPlatformAdminRuntime ||
    security.isMemberMigrationRunner ||
    security.isMemberMigrationOwner
  ) {
    throw new Error(
      'PostgreSQL platform admin operator login does not satisfy the required least privilege policy.',
    );
  }

  await assertDoesNotOwnApplicationObjects(
    database,
    'PostgreSQL platform admin operator login must not own application objects.',
  );
};

export const assertPlatformAdminRuntimeConnectionSecurity = async (
  database: Sequelize,
): Promise<void> => {
  const security = await readConnectionRoleSecurity(database);
  if (
    hasElevatedAttributes(security) ||
    !security.canLogin ||
    security.roleName !== databaseRoles.platformAdminRuntime ||
    !security.isMemberPlatformAdminRuntime ||
    security.isMemberRuntime ||
    security.isMemberPlatformAdminOperator ||
    security.isMemberMigrationRunner ||
    security.isMemberMigrationOwner
  ) {
    throw new Error(
      'PostgreSQL platform admin runtime login does not satisfy the required least privilege policy.',
    );
  }

  await assertDoesNotOwnApplicationObjects(
    database,
    'PostgreSQL platform admin runtime login must not own application objects.',
  );
};
