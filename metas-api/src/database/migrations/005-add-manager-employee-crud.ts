import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
CREATE FUNCTION metas.require_manager_store()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  target_store_id UUID;
BEGIN
  SELECT employee.store_id
  INTO target_store_id
  FROM metas.employees employee
  JOIN metas.users app_user ON app_user.id = employee.user_id
  JOIN metas.stores store ON store.id = employee.store_id
  WHERE employee.id = metas.safe_context_uuid('app.current_employee_id')
    AND employee.user_id = metas.safe_context_uuid('app.current_user_id')
    AND employee.store_id = metas.safe_context_uuid('app.current_store_id')
    AND employee.role = 'GESTOR'
    AND employee.status = 'ATIVO'
    AND app_user.account_status = 'ACTIVE'
    AND store.is_active = TRUE;

  IF target_store_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANAGER_ACCESS_REQUIRED';
  END IF;

  RETURN target_store_id;
END
$function$;

CREATE FUNCTION metas.manager_list_employees()
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
  ORDER BY app_user.full_name, employee.id;
END
$function$;

CREATE FUNCTION metas.manager_get_employee(target_employee_id UUID)
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
    AND employee.store_id = target_store_id;
END
$function$;

CREATE FUNCTION metas.manager_create_employee(
  employee_name TEXT,
  employee_email TEXT,
  employee_role TEXT,
  employee_status TEXT,
  employee_joined_on DATE
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
  manager_store_id UUID;
  manager_user_id UUID;
  new_employee_id UUID;
  new_user_id UUID;
  normalized_email TEXT;
  normalized_name TEXT;
BEGIN
  manager_store_id := metas.require_manager_store();
  manager_user_id := metas.safe_context_uuid('app.current_user_id');
  normalized_name := btrim(employee_name);
  normalized_email := lower(btrim(employee_email));

  IF normalized_name IS NULL OR char_length(normalized_name) < 3 OR char_length(normalized_name) > 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_NAME';
  END IF;
  IF normalized_email IS NULL OR char_length(normalized_email) > 320
    OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_EMAIL';
  END IF;
  IF employee_role NOT IN ('GESTOR', 'BALCONISTA', 'CAIXA', 'FARMACEUTICO') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_ROLE';
  END IF;
  IF employee_status NOT IN ('ATIVO', 'INATIVO') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_STATUS';
  END IF;
  IF employee_joined_on IS NULL OR employee_joined_on > CURRENT_DATE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_JOINED_ON';
  END IF;

  PERFORM 1 FROM metas.stores WHERE metas.stores.id = manager_store_id FOR UPDATE;

  INSERT INTO metas.users (full_name, primary_email, account_status)
  VALUES (normalized_name, normalized_email::public.citext, 'PENDING')
  RETURNING metas.users.id INTO new_user_id;

  INSERT INTO metas.employees (
    store_id,
    user_id,
    role,
    status,
    joined_on,
    ended_on,
    created_by_user_id,
    creation_source
  ) VALUES (
    manager_store_id,
    new_user_id,
    employee_role::metas.employee_role,
    employee_status,
    employee_joined_on,
    CASE WHEN employee_status = 'INATIVO' THEN employee_joined_on ELSE NULL END,
    manager_user_id,
    'MANAGER'
  )
  RETURNING metas.employees.id INTO new_employee_id;

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
  WHERE employee.id = new_employee_id;
END
$function$;

CREATE FUNCTION metas.manager_update_employee(
  target_employee_id UUID,
  employee_name TEXT,
  employee_email TEXT,
  employee_role TEXT,
  employee_status TEXT,
  employee_joined_on DATE
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
  current_manager_employee_id UUID;
  manager_store_id UUID;
  normalized_email TEXT;
  normalized_name TEXT;
  target_current_role TEXT;
  target_current_status TEXT;
  target_user_id UUID;
BEGIN
  manager_store_id := metas.require_manager_store();
  current_manager_employee_id := metas.safe_context_uuid('app.current_employee_id');
  normalized_name := btrim(employee_name);
  normalized_email := lower(btrim(employee_email));

  IF normalized_name IS NULL OR char_length(normalized_name) < 3 OR char_length(normalized_name) > 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_NAME';
  END IF;
  IF normalized_email IS NULL OR char_length(normalized_email) > 320
    OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_EMAIL';
  END IF;
  IF employee_role NOT IN ('GESTOR', 'BALCONISTA', 'CAIXA', 'FARMACEUTICO') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_ROLE';
  END IF;
  IF employee_status NOT IN ('ATIVO', 'INATIVO') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_STATUS';
  END IF;
  IF employee_joined_on IS NULL OR employee_joined_on > CURRENT_DATE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_JOINED_ON';
  END IF;

  SELECT employee.user_id, employee.role::TEXT, employee.status
  INTO target_user_id, target_current_role, target_current_status
  FROM metas.employees employee
  WHERE employee.id = target_employee_id
    AND employee.store_id = manager_store_id
  FOR UPDATE;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'EMPLOYEE_NOT_FOUND';
  END IF;

  IF target_employee_id = current_manager_employee_id
    AND (employee_role <> target_current_role OR employee_status <> target_current_status) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SELF_MANAGER_ACCESS_CHANGE_FORBIDDEN';
  END IF;

  UPDATE metas.users
  SET full_name = normalized_name,
      primary_email = normalized_email::public.citext,
      lock_version = lock_version + 1
  WHERE metas.users.id = target_user_id;

  UPDATE metas.employees
  SET role = employee_role::metas.employee_role,
      status = employee_status,
      joined_on = employee_joined_on,
      ended_on = CASE
        WHEN employee_status = 'ATIVO' THEN NULL
        ELSE GREATEST(employee_joined_on, CURRENT_DATE)
      END,
      lock_version = lock_version + 1
  WHERE metas.employees.id = target_employee_id;

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
  WHERE employee.id = target_employee_id;
END
$function$;

CREATE FUNCTION metas.manager_set_employee_status(
  target_employee_id UUID,
  employee_status TEXT
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
  current_manager_employee_id UUID;
  manager_store_id UUID;
  target_current_status TEXT;
BEGIN
  manager_store_id := metas.require_manager_store();
  current_manager_employee_id := metas.safe_context_uuid('app.current_employee_id');

  IF employee_status NOT IN ('ATIVO', 'INATIVO') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_EMPLOYEE_STATUS';
  END IF;

  SELECT employee.status
  INTO target_current_status
  FROM metas.employees employee
  WHERE employee.id = target_employee_id
    AND employee.store_id = manager_store_id
  FOR UPDATE;

  IF target_current_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'EMPLOYEE_NOT_FOUND';
  END IF;
  IF target_employee_id = current_manager_employee_id AND employee_status <> target_current_status THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SELF_MANAGER_ACCESS_CHANGE_FORBIDDEN';
  END IF;

  UPDATE metas.employees
  SET status = employee_status,
      ended_on = CASE
        WHEN employee_status = 'ATIVO' THEN NULL
        ELSE GREATEST(metas.employees.joined_on, CURRENT_DATE)
      END,
      lock_version = lock_version + 1
  WHERE metas.employees.id = target_employee_id;

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
  WHERE employee.id = target_employee_id;
END
$function$;

REVOKE EXECUTE ON FUNCTION metas.require_manager_store() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.manager_list_employees() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.manager_get_employee(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.manager_create_employee(TEXT, TEXT, TEXT, TEXT, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.manager_update_employee(UUID, TEXT, TEXT, TEXT, TEXT, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.manager_set_employee_status(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION metas.manager_list_employees() TO metas_app_runtime;
GRANT EXECUTE ON FUNCTION metas.manager_get_employee(UUID) TO metas_app_runtime;
GRANT EXECUTE ON FUNCTION metas.manager_create_employee(TEXT, TEXT, TEXT, TEXT, DATE)
  TO metas_app_runtime;
GRANT EXECUTE ON FUNCTION metas.manager_update_employee(UUID, TEXT, TEXT, TEXT, TEXT, DATE)
  TO metas_app_runtime;
GRANT EXECUTE ON FUNCTION metas.manager_set_employee_status(UUID, TEXT) TO metas_app_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
