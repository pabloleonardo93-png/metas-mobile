import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
CREATE FUNCTION metas.safe_context_uuid(setting_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  setting_value TEXT;
BEGIN
  setting_value := current_setting(setting_name, TRUE);
  IF setting_value IS NULL OR setting_value = '' THEN
    RETURN NULL;
  END IF;
  RETURN setting_value::UUID;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END
$function$;

CREATE FUNCTION metas.has_active_database_context()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, metas
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM metas.employees employee
    JOIN metas.users app_user ON app_user.id = employee.user_id
    JOIN metas.stores store ON store.id = employee.store_id
    WHERE employee.id = metas.safe_context_uuid('app.current_employee_id')
      AND employee.user_id = metas.safe_context_uuid('app.current_user_id')
      AND employee.store_id = metas.safe_context_uuid('app.current_store_id')
      AND employee.status = 'ATIVO'
      AND app_user.account_status = 'ACTIVE'
      AND store.is_active = TRUE
  )
$function$;

ALTER TABLE metas.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.stores FORCE ROW LEVEL SECURITY;
ALTER TABLE metas.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.users FORCE ROW LEVEL SECURITY;
ALTER TABLE metas.auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.auth_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE metas.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.employees FORCE ROW LEVEL SECURITY;
ALTER TABLE metas.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY stores_owner_all ON metas.stores
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY users_owner_all ON metas.users
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY auth_identities_owner_all ON metas.auth_identities
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY employees_owner_all ON metas.employees
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY sessions_owner_all ON metas.sessions
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY stores_runtime_select ON metas.stores
  FOR SELECT TO metas_app_runtime
  USING (
    metas.has_active_database_context()
    AND id = metas.safe_context_uuid('app.current_store_id')
  );
CREATE POLICY users_runtime_select ON metas.users
  FOR SELECT TO metas_app_runtime
  USING (
    metas.has_active_database_context()
    AND id = metas.safe_context_uuid('app.current_user_id')
  );
CREATE POLICY auth_identities_runtime_select ON metas.auth_identities
  FOR SELECT TO metas_app_runtime
  USING (
    metas.has_active_database_context()
    AND user_id = metas.safe_context_uuid('app.current_user_id')
  );
CREATE POLICY employees_runtime_select ON metas.employees
  FOR SELECT TO metas_app_runtime
  USING (
    metas.has_active_database_context()
    AND store_id = metas.safe_context_uuid('app.current_store_id')
  );
CREATE POLICY sessions_runtime_select ON metas.sessions
  FOR SELECT TO metas_app_runtime
  USING (
    metas.has_active_database_context()
    AND user_id = metas.safe_context_uuid('app.current_user_id')
    AND employee_id = metas.safe_context_uuid('app.current_employee_id')
  );

REVOKE ALL ON TABLE metas.stores FROM PUBLIC;
REVOKE ALL ON TABLE metas.users FROM PUBLIC;
REVOKE ALL ON TABLE metas.auth_identities FROM PUBLIC;
REVOKE ALL ON TABLE metas.employees FROM PUBLIC;
REVOKE ALL ON TABLE metas.sessions FROM PUBLIC;

GRANT SELECT ON TABLE metas.stores TO metas_app_runtime;
GRANT SELECT ON TABLE metas.users TO metas_app_runtime;
GRANT SELECT ON TABLE metas.auth_identities TO metas_app_runtime;
GRANT SELECT ON TABLE metas.employees TO metas_app_runtime;
GRANT SELECT ON TABLE metas.sessions TO metas_app_runtime;

REVOKE EXECUTE ON FUNCTION metas.safe_context_uuid(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.has_active_database_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION metas.safe_context_uuid(TEXT) TO metas_app_runtime;
GRANT EXECUTE ON FUNCTION metas.has_active_database_context() TO metas_app_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
