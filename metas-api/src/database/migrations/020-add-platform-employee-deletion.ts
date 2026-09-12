import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
ALTER TABLE metas.employees
  ADD COLUMN deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN deleted_by_platform_admin_id UUID NULL,
  ADD CONSTRAINT employees_deleted_by_platform_admin_fk
    FOREIGN KEY (deleted_by_platform_admin_id)
    REFERENCES metas.platform_admins (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT employees_deleted_state_valid CHECK (
    (deleted_at IS NULL AND deleted_by_platform_admin_id IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by_platform_admin_id IS NOT NULL)
  );

CREATE INDEX employees_operational_store_status_idx
  ON metas.employees (store_id, status, id)
  WHERE deleted_at IS NULL;

DROP POLICY employees_runtime_select ON metas.employees;
CREATE POLICY employees_runtime_select ON metas.employees
  FOR SELECT TO metas_app_runtime
  USING (
    metas.has_active_database_context()
    AND store_id = metas.safe_context_uuid('app.current_store_id')
    AND deleted_at IS NULL
  );

CREATE OR REPLACE FUNCTION metas.manager_list_employees()
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  primary_email TEXT,
  role TEXT,
  status TEXT,
  joined_on DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  target_store_id UUID;
BEGIN
  target_store_id := metas.require_manager_store();

  RETURN QUERY
  SELECT
    employee.id,
    app_user.full_name,
    app_user.primary_email::TEXT,
    employee.role::TEXT,
    employee.status,
    employee.joined_on
  FROM metas.employees employee
  JOIN metas.users app_user ON app_user.id = employee.user_id
  WHERE employee.store_id = target_store_id
    AND employee.deleted_at IS NULL
  ORDER BY app_user.full_name, employee.id;
END
$function$;

CREATE OR REPLACE FUNCTION metas.manager_get_employee(target_employee_id UUID)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  primary_email TEXT,
  role TEXT,
  status TEXT,
  joined_on DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  target_store_id UUID;
BEGIN
  target_store_id := metas.require_manager_store();

  RETURN QUERY
  SELECT
    employee.id,
    app_user.full_name,
    app_user.primary_email::TEXT,
    employee.role::TEXT,
    employee.status,
    employee.joined_on
  FROM metas.employees employee
  JOIN metas.users app_user ON app_user.id = employee.user_id
  WHERE employee.id = target_employee_id
    AND employee.store_id = target_store_id
    AND employee.deleted_at IS NULL;
END
$function$;

CREATE OR REPLACE FUNCTION metas.manager_list_employee_access_states()
RETURNS TABLE (
  employee_id UUID,
  access_email TEXT,
  google_linked BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  target_store_id UUID;
BEGIN
  target_store_id := metas.require_manager_store();

  RETURN QUERY
  SELECT
    employee.id,
    COALESCE(identity.provider_email::TEXT, app_user.primary_email::TEXT),
    identity.id IS NOT NULL
  FROM metas.employees employee
  JOIN metas.users app_user ON app_user.id = employee.user_id
  LEFT JOIN metas.auth_identities identity
    ON identity.user_id = app_user.id
   AND identity.provider = 'GOOGLE'
   AND identity.disabled_at IS NULL
  WHERE employee.store_id = target_store_id
    AND employee.deleted_at IS NULL;
END
$function$;

CREATE OR REPLACE FUNCTION metas.manager_change_employee_access_email(
  target_employee_id UUID,
  new_access_email TEXT
)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  primary_email TEXT,
  role TEXT,
  status TEXT,
  joined_on DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  active_identity_email TEXT;
  manager_store_id UUID;
  normalized_email TEXT;
  target_primary_email TEXT;
  target_user_id UUID;
BEGIN
  manager_store_id := metas.require_manager_store();
  normalized_email := lower(btrim(new_access_email));

  IF normalized_email IS NULL OR char_length(normalized_email) > 320
    OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_EMAIL';
  END IF;

  SELECT employee.user_id
  INTO target_user_id
  FROM metas.employees employee
  WHERE employee.id = target_employee_id
    AND employee.store_id = manager_store_id
    AND employee.deleted_at IS NULL
  FOR UPDATE;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'EMPLOYEE_NOT_FOUND';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM metas.employees employee
    WHERE employee.user_id = target_user_id
      AND employee.store_id <> manager_store_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'EMPLOYEE_ACCESS_EMAIL_MULTIPLE_STORES_FORBIDDEN';
  END IF;

  SELECT identity.provider_email::TEXT
  INTO active_identity_email
  FROM metas.auth_identities identity
  WHERE identity.user_id = target_user_id
    AND identity.provider = 'GOOGLE'
    AND identity.disabled_at IS NULL
  FOR UPDATE;

  SELECT app_user.primary_email::TEXT
  INTO target_primary_email
  FROM metas.users app_user
  WHERE app_user.id = target_user_id
  FOR UPDATE;

  IF normalized_email::public.citext =
    COALESCE(active_identity_email, target_primary_email)::public.citext THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'EMPLOYEE_ACCESS_EMAIL_UNCHANGED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM metas.users app_user
    WHERE app_user.primary_email = normalized_email::public.citext
      AND app_user.id <> target_user_id
    UNION ALL
    SELECT 1
    FROM metas.auth_identities identity
    WHERE identity.provider = 'GOOGLE'
      AND identity.provider_email = normalized_email::public.citext
      AND identity.user_id <> target_user_id
      AND identity.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'EMPLOYEE_ACCESS_EMAIL_ALREADY_EXISTS';
  END IF;

  UPDATE metas.auth_identities identity
  SET disabled_at = COALESCE(identity.disabled_at, now())
  WHERE identity.user_id = target_user_id
    AND identity.provider = 'GOOGLE'
    AND identity.disabled_at IS NULL;

  UPDATE metas.sessions session
  SET revoked_at = COALESCE(session.revoked_at, now())
  WHERE session.user_id = target_user_id
    AND session.revoked_at IS NULL;

  UPDATE metas.users app_user
  SET primary_email = normalized_email::public.citext,
      email_verified_at = NULL,
      lock_version = app_user.lock_version + 1
  WHERE app_user.id = target_user_id;

  RETURN QUERY
  SELECT
    employee.id,
    app_user.full_name,
    app_user.primary_email::TEXT,
    employee.role::TEXT,
    employee.status,
    employee.joined_on
  FROM metas.employees employee
  JOIN metas.users app_user ON app_user.id = employee.user_id
  WHERE employee.id = target_employee_id
    AND employee.store_id = manager_store_id
    AND employee.deleted_at IS NULL;
END
$function$;

CREATE OR REPLACE FUNCTION metas.read_platform_directory(resource TEXT, filters JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE rows JSONB; total_count BIGINT; page_number INTEGER; page_size INTEGER;
  search TEXT; filter_status TEXT; filter_role TEXT; filter_store UUID;
BEGIN
  PERFORM metas.require_platform_management_context();
  IF resource IS NULL OR jsonb_typeof(filters) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MANAGEMENT_INVALID_INPUT';
  END IF;
  page_number := COALESCE((filters->>'page')::INTEGER, 1);
  page_size := COALESCE((filters->>'pageSize')::INTEGER, 20);
  search := COALESCE(filters->>'q', '');
  filter_status := COALESCE(filters->>'status', 'ALL');
  filter_role := COALESCE(filters->>'role', 'ALL');
  filter_store := (filters->>'storeId')::UUID;
  IF resource NOT IN ('pharmacies', 'employees', 'audit') OR page_number NOT BETWEEN 1 AND 100000
    OR page_size NOT BETWEEN 1 AND 50 OR length(search) > 100
    OR filter_status NOT IN ('ALL', 'ACTIVE', 'INACTIVE')
    OR filter_role NOT IN ('ALL', 'GESTOR', 'BALCONISTA', 'CAIXA', 'FARMACEUTICO') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MANAGEMENT_INVALID_INPUT';
  END IF;
  IF resource = 'pharmacies' THEN
    WITH filtered AS (
      SELECT s.* FROM metas.stores s
      WHERE (search = '' OR strpos(lower(s.name), lower(search)) > 0 OR strpos(lower(s.slug::TEXT), lower(search)) > 0)
        AND (filter_status = 'ALL' OR s.is_active = (filter_status = 'ACTIVE'))
    ), page_rows AS (
      SELECT * FROM filtered ORDER BY lower(name), id LIMIT page_size OFFSET (page_number-1)*page_size
    )
    SELECT (SELECT count(*) FROM filtered), COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'slug', s.slug, 'timezone', s.timezone,
      'isActive', s.is_active, 'version', s.lock_version, 'updatedAt', s.updated_at,
      'employeeCount', (SELECT count(*) FROM metas.employees e WHERE e.store_id=s.id AND e.status='ATIVO' AND e.deleted_at IS NULL),
      'managers', (SELECT COALESCE(jsonb_agg(u.full_name ORDER BY u.full_name), '[]'::JSONB)
        FROM metas.employees e JOIN metas.users u ON u.id=e.user_id
        WHERE e.store_id=s.id AND e.status='ATIVO' AND e.role='GESTOR' AND e.deleted_at IS NULL)
    ) ORDER BY lower(s.name), s.id), '[]'::JSONB) INTO total_count, rows FROM page_rows s;
  ELSIF resource = 'employees' THEN
    WITH filtered AS (
      SELECT e.*, u.full_name, u.primary_email, u.account_status, u.lock_version AS user_version, s.name AS store_name
      FROM metas.employees e JOIN metas.users u ON u.id=e.user_id JOIN metas.stores s ON s.id=e.store_id
      WHERE e.deleted_at IS NULL
        AND (search = '' OR strpos(lower(u.full_name), lower(search)) > 0 OR strpos(lower(u.primary_email::TEXT), lower(search)) > 0)
        AND (filter_status='ALL' OR e.status=CASE WHEN filter_status='ACTIVE' THEN 'ATIVO' ELSE 'INATIVO' END)
        AND (filter_role='ALL' OR e.role::TEXT=filter_role)
        AND (filter_store IS NULL OR e.store_id=filter_store)
    ), page_rows AS (
      SELECT * FROM filtered ORDER BY lower(full_name), id LIMIT page_size OFFSET (page_number-1)*page_size
    )
    SELECT (SELECT count(*) FROM filtered), COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id, 'userId', e.user_id, 'storeId', e.store_id, 'storeName', e.store_name,
      'name', e.full_name, 'email', e.primary_email, 'role', e.role, 'status', e.status,
      'accountStatus', e.account_status, 'joinedOn', e.joined_on, 'endedOn', e.ended_on,
      'version', e.lock_version, 'userVersion', e.user_version, 'updatedAt', e.updated_at
    ) ORDER BY lower(e.full_name), e.id), '[]'::JSONB) INTO total_count, rows FROM page_rows e;
  ELSE
    WITH filtered AS (
      SELECT a.*, p.display_name AS actor FROM metas.platform_admin_audit_events a
      JOIN metas.platform_admins p ON p.id=a.platform_admin_id
      WHERE a.target_type IN ('store', 'employee')
        AND (search='' OR strpos(lower(a.action), lower(search)) > 0 OR strpos(lower(p.display_name), lower(search)) > 0)
    ), page_rows AS (
      SELECT * FROM filtered ORDER BY created_at DESC, id DESC LIMIT page_size OFFSET (page_number-1)*page_size
    )
    SELECT (SELECT count(*) FROM filtered), COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id, 'action', a.action, 'actor', a.actor, 'targetType', a.target_type,
      'targetId', a.target_id, 'outcome', a.outcome, 'createdAt', a.created_at
    ) ORDER BY a.created_at DESC, a.id DESC), '[]'::JSONB) INTO total_count, rows FROM page_rows a;
  END IF;
  RETURN jsonb_build_object('items', rows, 'total', total_count, 'page', page_number, 'pageSize', page_size);
END
$function$;

CREATE FUNCTION metas.prevent_deleted_employee_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'MANAGEMENT_EMPLOYEE_ALREADY_DELETED';
  END IF;
  IF TG_OP = 'INSERT'
    AND EXISTS (
      SELECT 1 FROM metas.employees employee
      WHERE employee.user_id = NEW.user_id AND employee.deleted_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM metas.employees employee
      WHERE employee.user_id = NEW.user_id AND employee.deleted_at IS NULL
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'MANAGEMENT_EMPLOYEE_ALREADY_DELETED';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER employees_prevent_deleted_mutation
BEFORE INSERT OR UPDATE ON metas.employees
FOR EACH ROW EXECUTE FUNCTION metas.prevent_deleted_employee_mutation();

CREATE FUNCTION metas.delete_platform_employee(
  target_employee_id UUID,
  expected_employee_version INTEGER,
  expected_user_version INTEGER,
  minimum_step_up_at TIMESTAMPTZ,
  operation_request_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor_id UUID;
  account_disabled BOOLEAN;
  has_remaining_employee BOOLEAN;
  other_active_managers BIGINT;
  previous_employee metas.employees%ROWTYPE;
  previous_user metas.users%ROWTYPE;
BEGIN
  IF target_employee_id IS NULL OR expected_employee_version IS NULL
    OR expected_user_version IS NULL OR minimum_step_up_at IS NULL
    OR operation_request_id IS NULL OR expected_employee_version < 1 OR expected_user_version < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MANAGEMENT_INVALID_INPUT';
  END IF;
  actor_id := metas.require_platform_admin_step_up_context(minimum_step_up_at);

  SELECT * INTO previous_employee
  FROM metas.employees employee
  WHERE employee.id = target_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MANAGEMENT_NOT_FOUND';
  END IF;

  PERFORM 1 FROM metas.stores store WHERE store.id = previous_employee.store_id FOR UPDATE;
  SELECT * INTO previous_employee
  FROM metas.employees employee
  WHERE employee.id = target_employee_id
  FOR UPDATE;
  IF previous_employee.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'MANAGEMENT_EMPLOYEE_ALREADY_DELETED';
  END IF;

  SELECT * INTO previous_user
  FROM metas.users app_user
  WHERE app_user.id = previous_employee.user_id
  FOR UPDATE;
  IF previous_employee.lock_version IS DISTINCT FROM expected_employee_version
    OR previous_user.lock_version IS DISTINCT FROM expected_user_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'MANAGEMENT_VERSION_CONFLICT';
  END IF;

  IF previous_employee.role = 'GESTOR' AND previous_employee.status = 'ATIVO' THEN
    SELECT count(*) INTO other_active_managers
    FROM metas.employees manager
    WHERE manager.store_id = previous_employee.store_id
      AND manager.id <> previous_employee.id
      AND manager.role = 'GESTOR'
      AND manager.status = 'ATIVO'
      AND manager.deleted_at IS NULL;
    IF other_active_managers = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LAST_ACTIVE_MANAGER_DELETE_REQUIRED';
    END IF;
  END IF;

  UPDATE metas.employees employee
  SET status = 'INATIVO',
      ended_on = GREATEST(employee.joined_on, CURRENT_DATE),
      deleted_at = now(),
      deleted_by_platform_admin_id = actor_id,
      lock_version = employee.lock_version + 1
  WHERE employee.id = target_employee_id;

  UPDATE metas.sessions session
  SET revoked_at = COALESCE(session.revoked_at, now())
  WHERE session.employee_id = target_employee_id
    AND session.revoked_at IS NULL;

  SELECT EXISTS (
    SELECT 1 FROM metas.employees employee
    WHERE employee.user_id = previous_employee.user_id
      AND employee.deleted_at IS NULL
  ) INTO has_remaining_employee;
  account_disabled := NOT has_remaining_employee;

  IF account_disabled THEN
    UPDATE metas.auth_identities identity
    SET disabled_at = COALESCE(identity.disabled_at, now())
    WHERE identity.user_id = previous_employee.user_id
      AND identity.disabled_at IS NULL;
    UPDATE metas.sessions session
    SET revoked_at = COALESCE(session.revoked_at, now())
    WHERE session.user_id = previous_employee.user_id
      AND session.revoked_at IS NULL;
    UPDATE metas.users app_user
    SET account_status = 'DISABLED',
        lock_version = app_user.lock_version + 1
    WHERE app_user.id = previous_employee.user_id;
  END IF;

  INSERT INTO metas.platform_admin_audit_events(
    platform_admin_id, action, target_type, target_id, store_id,
    request_id, outcome, metadata
  ) VALUES(
    actor_id, 'EMPLOYEE_DELETED', 'employee', target_employee_id,
    previous_employee.store_id, operation_request_id, 'SUCCESS',
    jsonb_build_object(
      'role', previous_employee.role,
      'previousStatus', previous_employee.status,
      'accountDisabled', account_disabled
    )
  );

  RETURN target_employee_id;
END
$function$;

REVOKE ALL ON FUNCTION metas.prevent_deleted_employee_mutation()
  FROM PUBLIC, metas_app_runtime, metas_migration_runner,
    metas_platform_admin_operator, metas_platform_admin_runtime;
REVOKE ALL ON FUNCTION metas.manager_change_employee_access_email(UUID, TEXT)
  FROM PUBLIC, metas_migration_runner, metas_platform_admin_operator,
    metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.manager_change_employee_access_email(UUID, TEXT)
  TO metas_app_runtime;
REVOKE ALL ON FUNCTION metas.delete_platform_employee(UUID, INTEGER, INTEGER, TIMESTAMPTZ, UUID)
  FROM PUBLIC, metas_app_runtime, metas_migration_runner, metas_platform_admin_operator;
GRANT EXECUTE ON FUNCTION metas.delete_platform_employee(UUID, INTEGER, INTEGER, TIMESTAMPTZ, UUID)
  TO metas_platform_admin_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
