import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
CREATE FUNCTION metas.create_platform_employee(
  requested_name TEXT,
  requested_email public.citext,
  requested_store_id UUID,
  requested_role TEXT,
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
  existing_user_id UUID;
  new_employee_id UUID;
  new_user_id UUID;
  normalized_email public.citext;
  normalized_name TEXT;
BEGIN
  actor_id := metas.require_platform_admin_step_up_context(minimum_step_up_at);
  normalized_name := btrim(requested_name);
  normalized_email := lower(btrim(requested_email::TEXT))::public.citext;

  IF requested_name IS NULL OR requested_email IS NULL OR requested_store_id IS NULL
    OR requested_role IS NULL OR minimum_step_up_at IS NULL OR operation_request_id IS NULL
    OR char_length(normalized_name) NOT BETWEEN 2 AND 150
    OR char_length(normalized_email::TEXT) NOT BETWEEN 3 AND 320
    OR normalized_email::TEXT !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    OR requested_role NOT IN ('GESTOR', 'BALCONISTA', 'CAIXA', 'FARMACEUTICO') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MANAGEMENT_INVALID_INPUT';
  END IF;

  PERFORM 1
  FROM metas.stores store
  WHERE store.id = requested_store_id
    AND store.is_active = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'MANAGEMENT_STORE_INACTIVE';
  END IF;

  SELECT app_user.id
  INTO existing_user_id
  FROM metas.users app_user
  WHERE app_user.primary_email = normalized_email
  FOR UPDATE;

  IF existing_user_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM metas.employees employee
      WHERE employee.user_id = existing_user_id
        AND employee.store_id = requested_store_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'MANAGEMENT_LINK_EXISTS';
    END IF;
    IF EXISTS (
      SELECT 1 FROM metas.employees employee
      WHERE employee.user_id = existing_user_id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'MANAGEMENT_MULTIPLE_STORES_UNSUPPORTED';
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'MANAGEMENT_EMPLOYEE_EMAIL_EXISTS';
  END IF;

  BEGIN
    INSERT INTO metas.users(full_name, primary_email, account_status)
    VALUES(normalized_name, normalized_email, 'PENDING')
    RETURNING id INTO new_user_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'MANAGEMENT_EMPLOYEE_EMAIL_EXISTS';
  END;

  INSERT INTO metas.employees(
    store_id,
    user_id,
    role,
    status,
    joined_on,
    creation_source,
    created_by_platform_admin_id
  ) VALUES(
    requested_store_id,
    new_user_id,
    requested_role::metas.employee_role,
    'ATIVO',
    CURRENT_DATE,
    'PLATFORM_ADMIN',
    actor_id
  )
  RETURNING id INTO new_employee_id;

  INSERT INTO metas.platform_admin_audit_events(
    platform_admin_id,
    action,
    target_type,
    target_id,
    store_id,
    request_id,
    outcome,
    metadata
  ) VALUES(
    actor_id,
    'EMPLOYEE_CREATED',
    'employee',
    new_employee_id,
    requested_store_id,
    operation_request_id,
    'SUCCESS',
    jsonb_build_object('role', requested_role, 'accountStatus', 'PENDING')
  );

  RETURN new_employee_id;
END
$function$;

REVOKE ALL ON FUNCTION metas.create_platform_employee(
  TEXT, public.citext, UUID, TEXT, TIMESTAMPTZ, UUID
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION metas.create_platform_employee(
  TEXT, public.citext, UUID, TEXT, TIMESTAMPTZ, UUID
) TO metas_platform_admin_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
