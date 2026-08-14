import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
ALTER TABLE metas.sessions ADD COLUMN token_hash BYTEA NULL;

UPDATE metas.sessions
SET token_hash = decode(
      md5(id::TEXT) || md5(id::TEXT || created_at::TEXT),
      'hex'
    ),
    revoked_at = COALESCE(revoked_at, now())
WHERE token_hash IS NULL;

ALTER TABLE metas.sessions ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE metas.sessions ADD CONSTRAINT sessions_token_hash_length
  CHECK (octet_length(token_hash) = 32);
CREATE UNIQUE INDEX sessions_token_hash_unique_idx ON metas.sessions (token_hash);

CREATE FUNCTION metas.authenticate_google_identity(
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
    SELECT app_user.id, app_user.account_status
    INTO target_user_id, current_account_status
    FROM metas.users app_user
    WHERE app_user.primary_email = btrim(verified_email)::public.citext
    FOR UPDATE;

    IF target_user_id IS NULL OR current_account_status = 'DISABLED' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUTH_ACCESS_DENIED';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM metas.auth_identities identity
      WHERE identity.user_id = target_user_id
        AND identity.provider = 'GOOGLE'
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
      btrim(verified_email),
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
    app_user.primary_email::TEXT,
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

CREATE FUNCTION metas.resolve_session(session_token_hash BYTEA)
RETURNS TABLE (
  user_id UUID,
  employee_id UUID,
  store_id UUID,
  role TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    session.user_id,
    session.employee_id,
    employee.store_id,
    employee.role::TEXT
  FROM metas.sessions session
  JOIN metas.users app_user ON app_user.id = session.user_id
  JOIN metas.employees employee
    ON employee.id = session.employee_id
   AND employee.user_id = session.user_id
  JOIN metas.stores store ON store.id = employee.store_id
  JOIN metas.auth_identities identity
    ON identity.id = session.auth_identity_id
   AND identity.user_id = session.user_id
  WHERE session.token_hash = session_token_hash
    AND session.revoked_at IS NULL
    AND session.expires_at > now()
    AND app_user.account_status = 'ACTIVE'
    AND employee.status = 'ATIVO'
    AND store.is_active = TRUE
    AND identity.disabled_at IS NULL
$function$;

CREATE FUNCTION metas.revoke_session(
  session_token_hash BYTEA,
  expected_user_id UUID,
  expected_employee_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE metas.sessions
  SET revoked_at = COALESCE(revoked_at, now())
  WHERE token_hash = session_token_hash
    AND user_id = expected_user_id
    AND employee_id = expected_employee_id;
  RETURN FOUND;
END
$function$;

REVOKE EXECUTE ON FUNCTION metas.authenticate_google_identity(
  TEXT, TEXT, BYTEA, TIMESTAMPTZ, INET, TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.resolve_session(BYTEA) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.revoke_session(BYTEA, UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION metas.authenticate_google_identity(
  TEXT, TEXT, BYTEA, TIMESTAMPTZ, INET, TEXT
) TO metas_app_runtime;
GRANT EXECUTE ON FUNCTION metas.resolve_session(BYTEA) TO metas_app_runtime;
GRANT EXECUTE ON FUNCTION metas.revoke_session(BYTEA, UUID, UUID) TO metas_app_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
