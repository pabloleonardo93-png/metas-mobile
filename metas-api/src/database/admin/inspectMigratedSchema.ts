import assert from 'node:assert/strict';

import { QueryTypes } from 'sequelize';

import { createDatabaseFromParameters, disconnectDatabase } from '../../config/database.js';
import { loadNorthflankMigrationDatabaseEnv } from '../../config/env.js';
import { logger } from '../../shared/logging/logger.js';
import { databaseRoles } from '../roles.js';

const expectedTables = [
  'auth_identities',
  'employees',
  'goal_roles',
  'goals',
  'schema_migrations',
  'sessions',
  'stores',
  'users',
] as const;

const expectedRlsTables = [
  'auth_identities',
  'employees',
  'goal_roles',
  'goals',
  'sessions',
  'stores',
  'users',
] as const;

const requiredConstraints = [
  'auth_identities_provider_subject_unique',
  'auth_identities_user_provider_unique',
  'employees_creation_actor_valid',
  'employees_store_user_unique',
  'goal_roles_goal_store_fk',
  'goals_business_days_valid',
  'goals_version_period_no_overlap',
  'sessions_employee_user_fk',
  'sessions_identity_user_fk',
  'sessions_token_hash_length',
  'stores_slug_unique',
  'users_primary_email_unique',
] as const;

const requiredIndexes = [
  'auth_identities_provider_email_idx',
  'employees_store_role_status_idx',
  'employees_store_status_idx',
  'goal_roles_store_role_idx',
  'goals_current_store_period_unique',
  'sessions_active_expiration_idx',
  'sessions_token_hash_unique_idx',
] as const;

const expectedSecurityDefinerFunctions = [
  'authenticate_google_identity',
  'bootstrap_first_manager',
  'enforce_employee_manager_invariants',
  'has_active_database_context',
  'manager_create_employee',
  'manager_get_employee',
  'manager_get_goal_configuration',
  'manager_list_employees',
  'manager_save_goal_configuration',
  'manager_set_employee_status',
  'manager_update_employee',
  'require_manager_store',
  'resolve_session',
  'revoke_session',
] as const;

interface NamedObject {
  name: string;
}

interface RlsStatus {
  forceRowSecurity: boolean;
  rowSecurity: boolean;
  tableName: string;
}

interface FunctionSecurity {
  functionName: string;
  hasFixedSearchPath: boolean;
  ownerName: string;
  publicCanExecute: boolean;
  runtimeCanExecute: boolean;
  securityDefiner: boolean;
}

interface RuntimeSecurity {
  bypassRls: boolean;
  canCreateInSchema: boolean;
  canReadMigrationStorage: boolean;
  hasDelete: boolean;
  hasInsert: boolean;
  hasSelect: boolean;
  hasUpdate: boolean;
  hasUsage: boolean;
}

interface OwnershipSummary {
  applicationObjectCount: string;
  objectsOwnedByMigrationOwner: string;
  schemaOwnedByMigrationOwner: boolean;
}

const names = (rows: NamedObject[]): string[] => rows.map(({ name }) => name);

let validationStage = 'connection';

const inspectMigratedSchema = async (): Promise<void> => {
  const env = loadNorthflankMigrationDatabaseEnv();
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
    const tables = await database.query<NamedObject>(
      `SELECT tablename AS name
       FROM pg_tables
       WHERE schemaname = 'metas'
       ORDER BY tablename`,
      { type: QueryTypes.SELECT },
    );
    const constraints = await database.query<NamedObject>(
      `SELECT constraint_object.conname AS name
       FROM pg_constraint constraint_object
       JOIN pg_namespace namespace ON namespace.oid = constraint_object.connamespace
       WHERE namespace.nspname = 'metas'
       ORDER BY constraint_object.conname`,
      { type: QueryTypes.SELECT },
    );
    const indexes = await database.query<NamedObject>(
      `SELECT indexname AS name
       FROM pg_indexes
       WHERE schemaname = 'metas'
       ORDER BY indexname`,
      { type: QueryTypes.SELECT },
    );
    const rls = await database.query<RlsStatus>(
      `SELECT
         relation.relname AS "tableName",
         relation.relrowsecurity AS "rowSecurity",
         relation.relforcerowsecurity AS "forceRowSecurity"
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'metas'
         AND relation.relname IN (
           'stores', 'users', 'auth_identities', 'employees', 'sessions', 'goals', 'goal_roles'
         )
       ORDER BY relation.relname`,
      { type: QueryTypes.SELECT },
    );
    const functions = await database.query<FunctionSecurity>(
      `SELECT
         procedure.proname AS "functionName",
         procedure.prosecdef AS "securityDefiner",
         owner.rolname AS "ownerName",
         EXISTS (
           SELECT 1 FROM unnest(COALESCE(procedure.proconfig, ARRAY[]::TEXT[])) setting
           WHERE setting LIKE 'search_path=%'
         ) AS "hasFixedSearchPath",
         has_function_privilege('public', procedure.oid, 'EXECUTE') AS "publicCanExecute",
         has_function_privilege(:runtime, procedure.oid, 'EXECUTE') AS "runtimeCanExecute"
       FROM pg_proc procedure
       JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
       JOIN pg_roles owner ON owner.oid = procedure.proowner
       WHERE namespace.nspname = 'metas'
         AND procedure.prosecdef = TRUE
       ORDER BY procedure.proname`,
      { replacements: { runtime: databaseRoles.runtime }, type: QueryTypes.SELECT },
    );
    const runtime = await database.query<RuntimeSecurity>(
      `SELECT
         role.rolbypassrls AS "bypassRls",
         has_schema_privilege(:runtime, 'metas', 'USAGE') AS "hasUsage",
         has_schema_privilege(:runtime, 'metas', 'CREATE') AS "canCreateInSchema",
         has_table_privilege(:runtime, 'metas.schema_migrations', 'SELECT')
           AS "canReadMigrationStorage",
         (SELECT bool_and(has_table_privilege(
            :runtime, 'metas.' || quote_ident(table_name), 'SELECT'
          )) FROM unnest(ARRAY[
            'stores', 'users', 'auth_identities', 'employees', 'sessions', 'goals', 'goal_roles'
          ])
          table_name) AS "hasSelect",
         (SELECT bool_or(has_table_privilege(
            :runtime, 'metas.' || quote_ident(table_name), 'INSERT'
          )) FROM unnest(ARRAY[
            'stores', 'users', 'auth_identities', 'employees', 'sessions', 'goals', 'goal_roles'
          ])
          table_name) AS "hasInsert",
         (SELECT bool_or(has_table_privilege(
            :runtime, 'metas.' || quote_ident(table_name), 'UPDATE'
          )) FROM unnest(ARRAY[
            'stores', 'users', 'auth_identities', 'employees', 'sessions', 'goals', 'goal_roles'
          ])
          table_name) AS "hasUpdate",
         (SELECT bool_or(has_table_privilege(
            :runtime, 'metas.' || quote_ident(table_name), 'DELETE'
          )) FROM unnest(ARRAY[
            'stores', 'users', 'auth_identities', 'employees', 'sessions', 'goals', 'goal_roles'
          ])
          table_name) AS "hasDelete"
       FROM pg_roles role
       WHERE role.rolname = :runtime`,
      { replacements: { runtime: databaseRoles.runtime }, type: QueryTypes.SELECT },
    );
    const ownership = await database.query<OwnershipSummary>(
      `SELECT
         (SELECT count(*)::TEXT
          FROM pg_class object
          JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
          WHERE namespace.nspname = 'metas'
            AND object.relkind IN ('r', 'i', 'S')) AS "applicationObjectCount",
         (SELECT count(*)::TEXT
          FROM pg_class object
          JOIN pg_namespace namespace ON namespace.oid = object.relnamespace
          JOIN pg_roles owner ON owner.oid = object.relowner
          WHERE namespace.nspname = 'metas'
            AND object.relkind IN ('r', 'i', 'S')
            AND owner.rolname = :migrationOwner) AS "objectsOwnedByMigrationOwner",
         (SELECT owner.rolname = :migrationOwner
          FROM pg_namespace namespace
          JOIN pg_roles owner ON owner.oid = namespace.nspowner
          WHERE namespace.nspname = 'metas') AS "schemaOwnedByMigrationOwner"`,
      {
        replacements: { migrationOwner: databaseRoles.migrationOwner },
        type: QueryTypes.SELECT,
      },
    );

    validationStage = 'tables';
    const tableNames = names(tables);
    const constraintNames = new Set(names(constraints));
    const indexNames = new Set(names(indexes));
    const missingConstraints = requiredConstraints.filter((name) => !constraintNames.has(name));
    const missingIndexes = requiredIndexes.filter((name) => !indexNames.has(name));
    assert.deepEqual(tableNames, [...expectedTables]);
    validationStage = 'constraints';
    if (missingConstraints.length > 0) {
      logger.error('migrated_schema_missing_constraints', {
        names: JSON.stringify(missingConstraints),
      });
    }
    assert.equal(missingConstraints.length, 0);
    validationStage = 'indexes';
    if (missingIndexes.length > 0) {
      logger.error('migrated_schema_missing_indexes', {
        names: JSON.stringify(missingIndexes),
      });
    }
    assert.equal(missingIndexes.length, 0);
    validationStage = 'rls-table-list';
    assert.deepEqual(
      rls.map(({ tableName }) => tableName),
      [...expectedRlsTables],
    );
    validationStage = 'rls-flags';
    assert.ok(rls.every(({ forceRowSecurity, rowSecurity }) => forceRowSecurity && rowSecurity));
    validationStage = 'security-definer-list';
    assert.deepEqual(
      functions.map(({ functionName }) => functionName),
      [...expectedSecurityDefinerFunctions],
    );
    validationStage = 'security-definer-properties';
    const runtimeExecutableFunctions = new Set([
      'authenticate_google_identity',
      'has_active_database_context',
      'manager_create_employee',
      'manager_get_employee',
      'manager_get_goal_configuration',
      'manager_list_employees',
      'manager_set_employee_status',
      'manager_save_goal_configuration',
      'manager_update_employee',
      'resolve_session',
      'revoke_session',
    ]);
    assert.ok(
      functions.every(
        ({
          functionName,
          hasFixedSearchPath,
          ownerName,
          publicCanExecute,
          runtimeCanExecute,
          securityDefiner,
        }) =>
          securityDefiner &&
          hasFixedSearchPath &&
          ownerName === databaseRoles.migrationOwner &&
          !publicCanExecute &&
          runtimeCanExecute === runtimeExecutableFunctions.has(functionName),
      ),
    );
    validationStage = 'runtime-grants';
    assert.deepEqual(runtime[0], {
      bypassRls: false,
      canCreateInSchema: false,
      canReadMigrationStorage: false,
      hasDelete: false,
      hasInsert: false,
      hasSelect: true,
      hasUpdate: false,
      hasUsage: true,
    });
    validationStage = 'schema-ownership';
    assert.equal(ownership[0]?.schemaOwnedByMigrationOwner, true);
    validationStage = 'object-ownership';
    assert.equal(ownership[0]?.applicationObjectCount, ownership[0]?.objectsOwnedByMigrationOwner);

    logger.info('migrated_schema_validated', {
      constraints: constraints.length,
      functions: functions.length,
      indexes: indexes.length,
      rlsTables: rls.length,
      tables: tables.length,
    });
  } finally {
    await disconnectDatabase(database);
  }
};

void inspectMigratedSchema().catch((error: unknown) => {
  logger.error('migrated_schema_validation_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
    validationStage,
  });
  process.exitCode = 1;
});
