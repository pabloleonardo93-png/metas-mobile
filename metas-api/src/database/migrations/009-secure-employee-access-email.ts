import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
ALTER TABLE metas.auth_identities
  DROP CONSTRAINT auth_identities_user_provider_unique;

CREATE UNIQUE INDEX auth_identities_active_user_provider_unique_idx
  ON metas.auth_identities (user_id, provider)
  WHERE disabled_at IS NULL;

CREATE FUNCTION metas.manager_list_employee_access_states()
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
  WHERE employee.store_id = target_store_id;
END
$function$;

CREATE OR REPLACE FUNCTION metas.manager_update_employee(
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
  active_identity_email TEXT;
  current_access_email TEXT;
  current_manager_employee_id UUID;
  google_identity_linked BOOLEAN := FALSE;
  manager_store_id UUID;
  normalized_email TEXT;
  normalized_name TEXT;
  target_current_role TEXT;
  target_current_status TEXT;
  target_primary_email TEXT;
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

  SELECT identity.provider_email::TEXT, TRUE
  INTO active_identity_email, google_identity_linked
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

  current_access_email := COALESCE(active_identity_email, target_primary_email);
  IF google_identity_linked
    AND normalized_email::public.citext <> current_access_email::public.citext THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'EMPLOYEE_ACCESS_EMAIL_CHANGE_REQUIRES_EXPLICIT_RESET';
  END IF;

  IF target_employee_id = current_manager_employee_id
    AND (employee_role <> target_current_role OR employee_status <> target_current_status) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SELF_MANAGER_ACCESS_CHANGE_FORBIDDEN';
  END IF;

  UPDATE metas.users
  SET full_name = normalized_name,
      primary_email = CASE
        WHEN google_identity_linked THEN metas.users.primary_email
        ELSE normalized_email::public.citext
      END,
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

CREATE FUNCTION metas.manager_change_employee_access_email(
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
    AND employee.store_id = manager_store_id;
END
$function$;

CREATE OR REPLACE FUNCTION metas.authenticate_google_identity(
  google_subject TEXT,
  verified_email TEXT,
  new_token_hash BYTEA,
  new_expires_at TIMESTAMPTZ,
  request_ip INET,
  request_user_agent TEXT
)
RETURNS TABLE (
  user_id UUID,
  employee_id UUID,
  store_id UUID,
  role TEXT,
  full_name TEXT,
  primary_email TEXT,
  employee_status TEXT,
  joined_on DATE,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  target_user_id UUID;
  target_identity_id UUID;
  target_employee_id UUID;
  target_store_id UUID;
  target_role TEXT;
  target_name TEXT;
  target_email TEXT;
  target_status TEXT;
  target_joined_on DATE;
  active_employee_count BIGINT;
  current_account_status TEXT;
BEGIN
  IF google_subject IS NULL OR btrim(google_subject) = '' OR char_length(google_subject) > 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GOOGLE_SUBJECT';
  END IF;
  IF verified_email IS NULL OR btrim(verified_email) = '' OR char_length(verified_email) > 320 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_VERIFIED_EMAIL';
  END IF;
  IF new_token_hash IS NULL OR octet_length(new_token_hash) <> 32 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SESSION_HASH';
  END IF;
  IF new_expires_at <= now() OR new_expires_at > now() + interval '31 days' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SESSION_EXPIRATION';
  END IF;
  IF request_user_agent IS NOT NULL AND char_length(request_user_agent) > 512 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_USER_AGENT';
  END IF;

  SELECT identity.id, identity.user_id
  INTO target_identity_id, target_user_id
  FROM metas.auth_identities identity
  WHERE identity.provider = 'GOOGLE'
    AND identity.provider_subject = google_subject
    AND identity.disabled_at IS NULL
  FOR UPDATE;

  IF target_identity_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM metas.auth_identities identity
      WHERE identity.provider = 'GOOGLE'
        AND identity.provider_subject = google_subject
        AND identity.disabled_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUTH_ACCESS_DENIED';
    END IF;

    SELECT app_user.id, app_user.account_status
    INTO target_user_id, current_account_status
    FROM metas.users app_user
    WHERE app_user.primary_email = lower(btrim(verified_email))::public.citext
    FOR UPDATE;

    IF target_user_id IS NULL OR current_account_status = 'DISABLED' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUTH_ACCESS_DENIED';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM metas.auth_identities identity
      WHERE identity.user_id = target_user_id
        AND identity.provider = 'GOOGLE'
        AND identity.disabled_at IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUTH_IDENTITY_CONFLICT';
    END IF;

    INSERT INTO metas.auth_identities (
      user_id,
      provider,
      provider_subject,
      provider_email,
      provider_verified_at,
      last_sign_in_at
    ) VALUES (
      target_user_id,
      'GOOGLE',
      google_subject,
      lower(btrim(verified_email)),
      now(),
      now()
    )
    RETURNING id INTO target_identity_id;

    UPDATE metas.users
    SET account_status = CASE WHEN account_status = 'PENDING' THEN 'ACTIVE' ELSE account_status END,
        email_verified_at = COALESCE(email_verified_at, now()),
        lock_version = lock_version + 1
    WHERE id = target_user_id;
  ELSE
    SELECT app_user.account_status
    INTO current_account_status
    FROM metas.users app_user
    WHERE app_user.id = target_user_id
    FOR UPDATE;

    IF current_account_status <> 'ACTIVE' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUTH_ACCESS_DENIED';
    END IF;

    UPDATE metas.auth_identities
    SET last_sign_in_at = now()
    WHERE id = target_identity_id;
  END IF;

  SELECT count(*)
  INTO active_employee_count
  FROM metas.employees employee
  JOIN metas.stores store ON store.id = employee.store_id
  WHERE employee.user_id = target_user_id
    AND employee.status = 'ATIVO'
    AND store.is_active = TRUE;

  IF active_employee_count = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUTH_ACCESS_DENIED';
  END IF;
  IF active_employee_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'EMPLOYEE_SELECTION_REQUIRED';
  END IF;

  SELECT
    employee.id,
    employee.store_id,
    employee.role::TEXT,
    app_user.full_name,
    COALESCE(identity.provider_email::TEXT, app_user.primary_email::TEXT),
    employee.status,
    employee.joined_on
  INTO
    target_employee_id,
    target_store_id,
    target_role,
    target_name,
    target_email,
    target_status,
    target_joined_on
  FROM metas.employees employee
  JOIN metas.users app_user ON app_user.id = employee.user_id
  JOIN metas.auth_identities identity
    ON identity.id = target_identity_id
   AND identity.user_id = app_user.id
   AND identity.disabled_at IS NULL
  WHERE employee.user_id = target_user_id
    AND employee.status = 'ATIVO';

  INSERT INTO metas.sessions (
    user_id,
    employee_id,
    auth_identity_id,
    token_hash,
    expires_at,
    ip_address,
    user_agent
  ) VALUES (
    target_user_id,
    target_employee_id,
    target_identity_id,
    new_token_hash,
    new_expires_at,
    request_ip,
    request_user_agent
  );

  RETURN QUERY SELECT
    target_user_id,
    target_employee_id,
    target_store_id,
    target_role,
    target_name,
    target_email,
    target_status,
    target_joined_on,
    new_expires_at;
END
$function$;

REVOKE EXECUTE ON FUNCTION metas.manager_list_employee_access_states() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.manager_change_employee_access_email(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.authenticate_google_identity(
  TEXT, TEXT, BYTEA, TIMESTAMPTZ, INET, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION metas.manager_list_employee_access_states() TO metas_app_runtime;
GRANT EXECUTE ON FUNCTION metas.manager_change_employee_access_email(UUID, TEXT)
  TO metas_app_runtime;
GRANT EXECUTE ON FUNCTION metas.authenticate_google_identity(
  TEXT, TEXT, BYTEA, TIMESTAMPTZ, INET, TEXT
) TO metas_app_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
