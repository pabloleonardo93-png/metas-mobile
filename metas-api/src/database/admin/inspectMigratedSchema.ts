import assert from 'node:assert/strict';

import { QueryTypes } from 'sequelize';

import { createDatabaseFromParameters, disconnectDatabase } from '../../config/database.js';
import { loadNorthflankMigrationDatabaseEnv } from '../../config/env.js';
import { logger } from '../../shared/logging/logger.js';
import { databaseRoles } from '../roles.js';

const expectedTables = [
  'auth_identities',
  'campaign_progress_entries',
  'campaigns',
  'employees',
  'goal_roles',
  'goals',
  'platform_admin_audit_events',
  'platform_admin_first_enrollment_requests',
  'platform_admin_identities',
  'platform_admin_sessions',
  'platform_admin_webauthn_challenges',
  'platform_admin_webauthn_credentials',
  'platform_admins',
  'schema_migrations',
  'sessions',
  'stores',
  'users',
] as const;

const expectedRlsTables = [
  'auth_identities',
  'campaign_progress_entries',
  'campaigns',
  'employees',
  'goal_roles',
  'goals',
  'platform_admin_audit_events',
  'platform_admin_first_enrollment_requests',
  'platform_admin_identities',
  'platform_admin_sessions',
  'platform_admin_webauthn_challenges',
  'platform_admin_webauthn_credentials',
  'platform_admins',
  'sessions',
  'stores',
  'users',
] as const;

const requiredConstraints = [
  'auth_identities_provider_subject_unique',
  'campaigns_period_valid',
  'campaigns_store_fk',
  'campaign_progress_entries_campaign_store_fk',
  'employees_creation_actor_valid',
  'employees_store_user_unique',
  'goal_roles_goal_store_fk',
  'goals_business_days_valid',
  'goals_version_period_no_overlap',
  'platform_admin_identities_provider_subject_unique',
  'platform_admin_sessions_identity_admin_fk',
  'platform_admin_sessions_token_hash_unique',
  'platform_admin_sessions_token_version_valid',
  'platform_admin_first_enrollment_requests_session_admin_fk',
  'platform_admin_first_enrollment_requests_state_valid',
  'platform_admin_webauthn_challenges_first_enrollment_request_fk',
  'platform_admin_webauthn_challenges_hash_unique',
  'platform_admin_webauthn_challenges_timestamps_valid',
  'platform_admin_webauthn_challenges_token_version_valid',
  'platform_admin_webauthn_credentials_credential_id_unique',
  'sessions_employee_user_fk',
  'sessions_identity_user_fk',
  'sessions_token_hash_length',
  'stores_slug_unique',
  'users_primary_email_unique',
] as const;

const requiredIndexes = [
  'auth_identities_active_user_provider_unique_idx',
  'auth_identities_provider_email_idx',
  'campaigns_store_closed_idx',
  'campaigns_store_period_idx',
  'campaign_progress_entries_store_campaign_created_idx',
  'employees_store_role_status_idx',
  'employees_store_status_idx',
  'goal_roles_store_role_idx',
  'goals_current_store_period_unique',
  'platform_admin_audit_events_admin_created_idx',
  'platform_admin_first_enrollment_requests_active_admin_idx',
  'platform_admin_first_enrollment_requests_session_idx',
  'platform_admin_first_enrollment_requests_status_expiry_idx',
  'platform_admin_identities_admin_idx',
  'platform_admin_sessions_active_expiration_idx',
  'platform_admin_webauthn_challenges_expiration_idx',
  'platform_admin_webauthn_challenges_first_enrollment_request_unique',
  'platform_admin_webauthn_challenges_session_active_idx',
  'platform_admin_webauthn_credentials_admin_active_idx',
  'sessions_active_expiration_idx',
  'sessions_token_hash_unique_idx',
] as const;

const expectedSecurityDefinerFunctions = [
  'approve_platform_admin_first_enrollment',
  'authenticate_google_identity',
  'authenticate_platform_admin_google',
  'bootstrap_first_manager',
  'bootstrap_platform_admin',
  'complete_platform_admin_webauthn_authentication',
  'consume_platform_admin_webauthn_challenge',
  'create_platform_admin_webauthn_challenge',
  'enforce_employee_manager_invariants',
  'get_platform_admin_first_enrollment_request_status',
  'get_platform_admin_me',
  'has_active_database_context',
  'list_platform_admin_webauthn_credentials',
  'manager_change_employee_access_email',
  'manager_close_campaign',
  'manager_create_campaign',
  'manager_create_campaign_progress_entry',
  'manager_create_employee',
  'manager_get_employee',
  'manager_get_goal_configuration',
  'manager_list_employee_access_states',
  'manager_list_employees',
  'manager_save_goal_configuration',
  'manager_set_employee_status',
  'manager_update_campaign',
  'manager_update_employee',
  'record_platform_admin_webauthn_failure',
  'register_platform_admin_webauthn_credential',
  'request_platform_admin_first_enrollment',
  'require_manager_store',
  'require_platform_admin_context',
  'resolve_platform_admin_session',
  'resolve_session',
  'revoke_platform_admin_session',
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
  migrationRunnerCanExecute: boolean;
  platformAdminOperatorCanExecute: boolean;
  platformAdminRuntimeCanExecute: boolean;
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
           'stores', 'users', 'auth_identities', 'employees', 'sessions', 'goals', 'goal_roles',
           'campaigns', 'campaign_progress_entries', 'platform_admins',
           'platform_admin_identities', 'platform_admin_sessions', 'platform_admin_audit_events',
           'platform_admin_first_enrollment_requests', 'platform_admin_webauthn_challenges',
           'platform_admin_webauthn_credentials'
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
         has_function_privilege(:runtime, procedure.oid, 'EXECUTE') AS "runtimeCanExecute",
         has_function_privilege(
           :platformAdminRuntime, procedure.oid, 'EXECUTE'
         ) AS "platformAdminRuntimeCanExecute",
         has_function_privilege(
           :migrationRunner, procedure.oid, 'EXECUTE'
         ) AS "migrationRunnerCanExecute",
         has_function_privilege(
           :platformAdminOperator, procedure.oid, 'EXECUTE'
         ) AS "platformAdminOperatorCanExecute"
       FROM pg_proc procedure
       JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
       JOIN pg_roles owner ON owner.oid = procedure.proowner
       WHERE namespace.nspname = 'metas'
         AND procedure.prosecdef = TRUE
       ORDER BY procedure.proname`,
      {
        replacements: {
          migrationRunner: databaseRoles.migrationRunner,
          platformAdminOperator: databaseRoles.platformAdminOperator,
          platformAdminRuntime: databaseRoles.platformAdminRuntime,
          runtime: databaseRoles.runtime,
        },
        type: QueryTypes.SELECT,
      },
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
            'stores', 'users', 'auth_identities', 'employees', 'sessions', 'goals', 'goal_roles',
            'campaigns', 'campaign_progress_entries'
          ])
          table_name) AS "hasSelect",
         (SELECT bool_or(has_table_privilege(
            :runtime, 'metas.' || quote_ident(table_name), 'INSERT'
          )) FROM unnest(ARRAY[
            'stores', 'users', 'auth_identities', 'employees', 'sessions', 'goals', 'goal_roles',
            'campaigns', 'campaign_progress_entries'
          ])
          table_name) AS "hasInsert",
         (SELECT bool_or(has_table_privilege(
            :runtime, 'metas.' || quote_ident(table_name), 'UPDATE'
          )) FROM unnest(ARRAY[
            'stores', 'users', 'auth_identities', 'employees', 'sessions', 'goals', 'goal_roles',
            'campaigns', 'campaign_progress_entries'
          ])
          table_name) AS "hasUpdate",
         (SELECT bool_or(has_table_privilege(
            :runtime, 'metas.' || quote_ident(table_name), 'DELETE'
          )) FROM unnest(ARRAY[
            'stores', 'users', 'auth_identities', 'employees', 'sessions', 'goals', 'goal_roles',
            'campaigns', 'campaign_progress_entries'
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
      'manager_change_employee_access_email',
      'manager_close_campaign',
      'manager_create_campaign',
      'manager_create_campaign_progress_entry',
      'manager_create_employee',
      'manager_get_employee',
      'manager_get_goal_configuration',
      'manager_list_employee_access_states',
      'manager_list_employees',
      'manager_set_employee_status',
      'manager_update_campaign',
      'manager_save_goal_configuration',
      'manager_update_employee',
      'resolve_session',
      'revoke_session',
    ]);
    const platformAdminRuntimeExecutableFunctions = new Set([
      'authenticate_platform_admin_google',
      'complete_platform_admin_webauthn_authentication',
      'consume_platform_admin_webauthn_challenge',
      'create_platform_admin_webauthn_challenge',
      'get_platform_admin_me',
      'list_platform_admin_webauthn_credentials',
      'record_platform_admin_webauthn_failure',
      'register_platform_admin_webauthn_credential',
      'request_platform_admin_first_enrollment',
      'resolve_platform_admin_session',
      'revoke_platform_admin_session',
    ]);
    const migrationRunnerExecutableFunctions = new Set([
      'bootstrap_first_manager',
      'bootstrap_platform_admin',
    ]);
    const platformAdminOperatorExecutableFunctions = new Set([
      'approve_platform_admin_first_enrollment',
      'get_platform_admin_first_enrollment_request_status',
    ]);
    assert.ok(
      functions.every(
        ({
          functionName,
          hasFixedSearchPath,
          migrationRunnerCanExecute,
          ownerName,
          platformAdminOperatorCanExecute,
          platformAdminRuntimeCanExecute,
          publicCanExecute,
          runtimeCanExecute,
          securityDefiner,
        }) =>
          securityDefiner &&
          hasFixedSearchPath &&
          ownerName === databaseRoles.migrationOwner &&
          !publicCanExecute &&
          runtimeCanExecute === runtimeExecutableFunctions.has(functionName) &&
          platformAdminRuntimeCanExecute ===
            platformAdminRuntimeExecutableFunctions.has(functionName) &&
          migrationRunnerCanExecute === migrationRunnerExecutableFunctions.has(functionName) &&
          platformAdminOperatorCanExecute ===
            platformAdminOperatorExecutableFunctions.has(functionName),
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
