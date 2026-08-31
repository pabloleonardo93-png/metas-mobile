import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
-- Administrative identities and session state
CREATE TABLE metas.platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  primary_email public.citext NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  lock_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_admins_display_name_valid CHECK (
    char_length(btrim(display_name)) BETWEEN 2 AND 160
  ),
  CONSTRAINT platform_admins_primary_email_valid CHECK (
    primary_email::TEXT = lower(btrim(primary_email::TEXT))
    AND char_length(primary_email::TEXT) BETWEEN 3 AND 320
    AND primary_email::TEXT LIKE '%@%'
  ),
  CONSTRAINT platform_admins_status_valid CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT platform_admins_lock_version_valid CHECK (lock_version >= 1),
  CONSTRAINT platform_admins_primary_email_unique UNIQUE (primary_email)
);

CREATE TABLE metas.platform_admin_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  observed_email public.citext NULL,
  provider_verified_at TIMESTAMPTZ NOT NULL,
  last_sign_in_at TIMESTAMPTZ NULL,
  disabled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_identities_admin_fk FOREIGN KEY (platform_admin_id)
    REFERENCES metas.platform_admins (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_identities_provider_valid CHECK (provider = 'GOOGLE'),
  CONSTRAINT platform_admin_identities_subject_valid CHECK (
    char_length(provider_subject) BETWEEN 1 AND 255
  ),
  CONSTRAINT platform_admin_identities_observed_email_valid CHECK (
    observed_email IS NULL OR (
      observed_email::TEXT = lower(btrim(observed_email::TEXT))
      AND char_length(observed_email::TEXT) BETWEEN 3 AND 320
      AND observed_email::TEXT LIKE '%@%'
    )
  ),
  CONSTRAINT platform_admin_identities_timestamps_valid CHECK (
    provider_verified_at >= created_at
    AND (last_sign_in_at IS NULL OR last_sign_in_at >= provider_verified_at)
    AND (disabled_at IS NULL OR disabled_at >= created_at)
  ),
  CONSTRAINT platform_admin_identities_provider_subject_unique
    UNIQUE (provider, provider_subject),
  CONSTRAINT platform_admin_identities_admin_provider_unique
    UNIQUE (platform_admin_id, provider),
  CONSTRAINT platform_admin_identities_id_admin_unique
    UNIQUE (id, platform_admin_id)
);

CREATE TABLE metas.platform_admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL,
  identity_id UUID NOT NULL,
  token_hash BYTEA NOT NULL,
  assurance_level TEXT NOT NULL DEFAULT 'GOOGLE_ONLY',
  mfa_verified_at TIMESTAMPTZ NULL,
  step_up_verified_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL,
  ip_address INET NULL,
  user_agent TEXT NULL,
  CONSTRAINT platform_admin_sessions_admin_fk FOREIGN KEY (platform_admin_id)
    REFERENCES metas.platform_admins (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_sessions_identity_admin_fk
    FOREIGN KEY (identity_id, platform_admin_id)
    REFERENCES metas.platform_admin_identities (id, platform_admin_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT platform_admin_sessions_token_hash_valid CHECK (octet_length(token_hash) = 32),
  CONSTRAINT platform_admin_sessions_assurance_valid CHECK (
    assurance_level IN ('GOOGLE_ONLY', 'MFA_VERIFIED')
  ),
  CONSTRAINT platform_admin_sessions_assurance_state_valid CHECK (
    (assurance_level = 'GOOGLE_ONLY' AND mfa_verified_at IS NULL)
    OR (assurance_level = 'MFA_VERIFIED' AND mfa_verified_at IS NOT NULL)
  ),
  CONSTRAINT platform_admin_sessions_expiration_valid CHECK (
    expires_at > created_at
    AND idle_expires_at > created_at
    AND idle_expires_at <= expires_at
  ),
  CONSTRAINT platform_admin_sessions_last_seen_valid CHECK (last_seen_at >= created_at),
  CONSTRAINT platform_admin_sessions_security_timestamps_valid CHECK (
    (mfa_verified_at IS NULL OR mfa_verified_at BETWEEN created_at AND expires_at)
    AND (
      step_up_verified_at IS NULL
      OR (
        mfa_verified_at IS NOT NULL
        AND step_up_verified_at BETWEEN mfa_verified_at AND expires_at
      )
    )
    AND (revoked_at IS NULL OR revoked_at >= created_at)
  ),
  CONSTRAINT platform_admin_sessions_user_agent_valid CHECK (
    user_agent IS NULL OR char_length(user_agent) <= 512
  )
);

CREATE TABLE metas.platform_admin_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NULL,
  target_id UUID NULL,
  store_id UUID NULL,
  request_id UUID NOT NULL,
  outcome TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip_address INET NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_audit_events_admin_fk FOREIGN KEY (platform_admin_id)
    REFERENCES metas.platform_admins (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_audit_events_store_fk FOREIGN KEY (store_id)
    REFERENCES metas.stores (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_audit_events_action_valid CHECK (
    char_length(action) BETWEEN 3 AND 100
  ),
  CONSTRAINT platform_admin_audit_events_target_valid CHECK (
    (target_type IS NULL AND target_id IS NULL)
    OR (
      target_type IS NOT NULL
      AND char_length(target_type) BETWEEN 2 AND 100
      AND target_id IS NOT NULL
    )
  ),
  CONSTRAINT platform_admin_audit_events_outcome_valid CHECK (
    outcome IN ('SUCCESS', 'DENIED', 'FAILURE')
  ),
  CONSTRAINT platform_admin_audit_events_metadata_valid CHECK (
    jsonb_typeof(metadata) = 'object'
    AND octet_length(metadata::TEXT) <= 8192
  ),
  CONSTRAINT platform_admin_audit_events_user_agent_valid CHECK (
    user_agent IS NULL OR char_length(user_agent) <= 512
  )
);

-- Query support for identities, active sessions and audit history
CREATE INDEX platform_admin_identities_admin_idx
  ON metas.platform_admin_identities (platform_admin_id);
CREATE INDEX platform_admin_sessions_admin_created_idx
  ON metas.platform_admin_sessions (platform_admin_id, created_at DESC);
CREATE INDEX platform_admin_sessions_active_expiration_idx
  ON metas.platform_admin_sessions (expires_at, idle_expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX platform_admin_audit_events_admin_created_idx
  ON metas.platform_admin_audit_events (platform_admin_id, created_at DESC, id DESC);
CREATE INDEX platform_admin_audit_events_store_created_idx
  ON metas.platform_admin_audit_events (store_id, created_at DESC, id DESC)
  WHERE store_id IS NOT NULL;
CREATE INDEX platform_admin_audit_events_target_idx
  ON metas.platform_admin_audit_events (target_type, target_id, created_at DESC)
  WHERE target_id IS NOT NULL;

-- Maintenance triggers
CREATE TRIGGER platform_admins_set_updated_at
BEFORE UPDATE ON metas.platform_admins
FOR EACH ROW EXECUTE FUNCTION metas.set_updated_at();
CREATE TRIGGER platform_admin_identities_set_updated_at
BEFORE UPDATE ON metas.platform_admin_identities
FOR EACH ROW EXECUTE FUNCTION metas.set_updated_at();

-- Deny-by-default row security
ALTER TABLE metas.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admins FORCE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_admins_owner_all ON metas.platform_admins
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY platform_admin_identities_owner_all ON metas.platform_admin_identities
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY platform_admin_sessions_owner_all ON metas.platform_admin_sessions
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY platform_admin_audit_events_owner_all ON metas.platform_admin_audit_events
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);

REVOKE ALL ON TABLE metas.platform_admins FROM PUBLIC, metas_app_runtime,
  metas_platform_admin_runtime;
REVOKE ALL ON TABLE metas.platform_admin_identities FROM PUBLIC, metas_app_runtime,
  metas_platform_admin_runtime;
REVOKE ALL ON TABLE metas.platform_admin_sessions FROM PUBLIC, metas_app_runtime,
  metas_platform_admin_runtime;
REVOKE ALL ON TABLE metas.platform_admin_audit_events FROM PUBLIC, metas_app_runtime,
  metas_platform_admin_runtime;

-- Explicit administrative capabilities
CREATE FUNCTION metas.bootstrap_platform_admin(
  bootstrap_display_name TEXT,
  bootstrap_primary_email public.citext,
  bootstrap_google_subject TEXT
)
RETURNS TABLE (
  platform_admin_id UUID,
  identity_id UUID,
  created BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  existing_admin_id UUID;
  existing_display_name TEXT;
  existing_identity_id UUID;
  existing_primary_email public.citext;
  normalized_display_name TEXT;
  normalized_email public.citext;
  new_admin_id UUID;
  new_identity_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(13013);
  normalized_display_name := btrim(bootstrap_display_name);
  normalized_email := lower(btrim(bootstrap_primary_email::TEXT))::public.citext;

  IF char_length(normalized_display_name) NOT BETWEEN 2 AND 160
    OR char_length(normalized_email::TEXT) NOT BETWEEN 3 AND 320
    OR normalized_email::TEXT NOT LIKE '%@%'
    OR char_length(bootstrap_google_subject) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PLATFORM_ADMIN_BOOTSTRAP';
  END IF;

  SELECT admin.id, admin.display_name, admin.primary_email, identity.id
  INTO existing_admin_id, existing_display_name, existing_primary_email, existing_identity_id
  FROM metas.platform_admins admin
  JOIN metas.platform_admin_identities identity
    ON identity.platform_admin_id = admin.id
   AND identity.provider = 'GOOGLE'
  WHERE admin.primary_email = normalized_email
     OR identity.provider_subject = bootstrap_google_subject
  FOR UPDATE OF admin, identity;

  IF FOUND THEN
    IF existing_display_name <> normalized_display_name
      OR existing_primary_email <> normalized_email
      OR NOT EXISTS (
        SELECT 1
        FROM metas.platform_admin_identities identity
        WHERE identity.id = existing_identity_id
          AND identity.provider_subject = bootstrap_google_subject
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'PLATFORM_ADMIN_BOOTSTRAP_CONFLICT';
    END IF;

    RETURN QUERY SELECT existing_admin_id, existing_identity_id, FALSE;
    RETURN;
  END IF;

  INSERT INTO metas.platform_admins (display_name, primary_email)
  VALUES (normalized_display_name, normalized_email)
  RETURNING id INTO new_admin_id;

  INSERT INTO metas.platform_admin_identities (
    platform_admin_id,
    provider,
    provider_subject,
    observed_email,
    provider_verified_at
  ) VALUES (
    new_admin_id,
    'GOOGLE',
    bootstrap_google_subject,
    normalized_email,
    now()
  )
  RETURNING id INTO new_identity_id;

  RETURN QUERY SELECT new_admin_id, new_identity_id, TRUE;
END
$function$;

CREATE FUNCTION metas.authenticate_platform_admin_google(
  google_subject TEXT,
  verified_email public.citext,
  new_token_hash BYTEA,
  absolute_expires_at TIMESTAMPTZ,
  inactivity_expires_at TIMESTAMPTZ,
  login_ip_address INET,
  login_user_agent TEXT,
  login_request_id UUID
)
RETURNS TABLE (
  platform_admin_id UUID,
  session_id UUID,
  display_name TEXT,
  primary_email TEXT,
  assurance_level TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  authenticated_admin_id UUID;
  authenticated_display_name TEXT;
  authenticated_identity_id UUID;
  authenticated_primary_email public.citext;
  new_session_id UUID;
  normalized_observed_email public.citext;
BEGIN
  normalized_observed_email := lower(btrim(verified_email::TEXT))::public.citext;
  IF char_length(google_subject) NOT BETWEEN 1 AND 255
    OR char_length(normalized_observed_email::TEXT) NOT BETWEEN 3 AND 320
    OR normalized_observed_email::TEXT NOT LIKE '%@%'
    OR octet_length(new_token_hash) <> 32
    OR absolute_expires_at <= now()
    OR inactivity_expires_at <= now()
    OR inactivity_expires_at > absolute_expires_at
    OR login_request_id IS NULL
    OR (login_user_agent IS NOT NULL AND char_length(login_user_agent) > 512) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PLATFORM_ADMIN_LOGIN';
  END IF;

  SELECT admin.id, admin.display_name, admin.primary_email, identity.id
  INTO authenticated_admin_id, authenticated_display_name,
    authenticated_primary_email, authenticated_identity_id
  FROM metas.platform_admin_identities identity
  JOIN metas.platform_admins admin ON admin.id = identity.platform_admin_id
  WHERE identity.provider = 'GOOGLE'
    AND identity.provider_subject = google_subject
    AND identity.disabled_at IS NULL
    AND admin.status = 'ACTIVE'
  FOR UPDATE OF admin, identity;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_ACCESS_DENIED';
  END IF;

  UPDATE metas.platform_admin_identities
  SET observed_email = normalized_observed_email,
      last_sign_in_at = now()
  WHERE id = authenticated_identity_id;

  INSERT INTO metas.platform_admin_sessions (
    platform_admin_id,
    identity_id,
    token_hash,
    assurance_level,
    expires_at,
    idle_expires_at,
    ip_address,
    user_agent
  ) VALUES (
    authenticated_admin_id,
    authenticated_identity_id,
    new_token_hash,
    'GOOGLE_ONLY',
    absolute_expires_at,
    inactivity_expires_at,
    login_ip_address,
    login_user_agent
  )
  RETURNING id INTO new_session_id;

  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id,
    action,
    target_type,
    target_id,
    request_id,
    outcome,
    metadata,
    ip_address,
    user_agent
  ) VALUES (
    authenticated_admin_id,
    'PLATFORM_ADMIN_LOGIN',
    'PLATFORM_ADMIN_SESSION',
    new_session_id,
    login_request_id,
    'SUCCESS',
    jsonb_build_object('assuranceLevel', 'GOOGLE_ONLY'),
    login_ip_address,
    login_user_agent
  );

  RETURN QUERY SELECT
    authenticated_admin_id,
    new_session_id,
    authenticated_display_name,
    authenticated_primary_email::TEXT,
    'GOOGLE_ONLY'::TEXT,
    absolute_expires_at;
END
$function$;

CREATE FUNCTION metas.resolve_platform_admin_session(
  requested_token_hash BYTEA,
  inactivity_timeout_seconds INTEGER
)
RETURNS TABLE (
  platform_admin_id UUID,
  session_id UUID,
  assurance_level TEXT,
  expires_at TIMESTAMPTZ,
  mfa_verified_at TIMESTAMPTZ,
  step_up_verified_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  resolved_admin_id UUID;
  resolved_assurance_level TEXT;
  resolved_expires_at TIMESTAMPTZ;
  resolved_mfa_verified_at TIMESTAMPTZ;
  resolved_session_id UUID;
  resolved_step_up_verified_at TIMESTAMPTZ;
  session_touch_interval_seconds CONSTANT INTEGER := 60;
BEGIN
  IF octet_length(requested_token_hash) <> 32
    OR inactivity_timeout_seconds NOT BETWEEN 300 AND 86400 THEN
    RETURN;
  END IF;

  SELECT session.platform_admin_id, session.id, session.assurance_level,
    session.expires_at, session.mfa_verified_at, session.step_up_verified_at
  INTO resolved_admin_id, resolved_session_id, resolved_assurance_level,
    resolved_expires_at, resolved_mfa_verified_at, resolved_step_up_verified_at
  FROM metas.platform_admin_sessions session
  JOIN metas.platform_admins admin ON admin.id = session.platform_admin_id
  JOIN metas.platform_admin_identities identity ON identity.id = session.identity_id
  WHERE session.token_hash = requested_token_hash
    AND session.revoked_at IS NULL
    AND session.expires_at > now()
    AND session.idle_expires_at > now()
    AND admin.status = 'ACTIVE'
    AND identity.disabled_at IS NULL
  FOR UPDATE OF session;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE metas.platform_admin_sessions AS session_update
  SET last_seen_at = now(),
      idle_expires_at = LEAST(
        session_update.expires_at,
        now() + make_interval(secs => inactivity_timeout_seconds)
      )
  WHERE session_update.id = resolved_session_id
    AND session_update.last_seen_at <=
      now() - make_interval(secs => session_touch_interval_seconds);

  RETURN QUERY SELECT
    resolved_admin_id,
    resolved_session_id,
    resolved_assurance_level,
    resolved_expires_at,
    resolved_mfa_verified_at,
    resolved_step_up_verified_at;
END
$function$;

CREATE FUNCTION metas.require_platform_admin_context()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  context_admin_id UUID;
  context_session_id UUID;
BEGIN
  context_admin_id := metas.safe_context_uuid('app.current_platform_admin_id');
  context_session_id := metas.safe_context_uuid('app.current_platform_admin_session_id');

  IF context_admin_id IS NULL OR context_session_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM metas.platform_admin_sessions session
    JOIN metas.platform_admins admin ON admin.id = session.platform_admin_id
    JOIN metas.platform_admin_identities identity ON identity.id = session.identity_id
    WHERE session.id = context_session_id
      AND session.platform_admin_id = context_admin_id
      AND session.revoked_at IS NULL
      AND session.expires_at > now()
      AND session.idle_expires_at > now()
      AND admin.status = 'ACTIVE'
      AND identity.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_CONTEXT_REQUIRED';
  END IF;

  RETURN context_admin_id;
END
$function$;

CREATE FUNCTION metas.get_platform_admin_me()
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  primary_email TEXT,
  status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  current_admin_id UUID;
BEGIN
  current_admin_id := metas.require_platform_admin_context();

  RETURN QUERY
  SELECT admin.id, admin.display_name, admin.primary_email::TEXT, admin.status
  FROM metas.platform_admins admin
  WHERE admin.id = current_admin_id;
END
$function$;

CREATE FUNCTION metas.revoke_platform_admin_session(
  logout_request_id UUID,
  logout_ip_address INET,
  logout_user_agent TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_admin_id UUID;
  current_session_id UUID;
BEGIN
  current_admin_id := metas.require_platform_admin_context();
  current_session_id := metas.safe_context_uuid('app.current_platform_admin_session_id');

  IF logout_request_id IS NULL
    OR (logout_user_agent IS NOT NULL AND char_length(logout_user_agent) > 512) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PLATFORM_ADMIN_LOGOUT';
  END IF;

  UPDATE metas.platform_admin_sessions
  SET revoked_at = now()
  WHERE id = current_session_id
    AND platform_admin_id = current_admin_id
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id,
    action,
    target_type,
    target_id,
    request_id,
    outcome,
    metadata,
    ip_address,
    user_agent
  ) VALUES (
    current_admin_id,
    'PLATFORM_ADMIN_LOGOUT',
    'PLATFORM_ADMIN_SESSION',
    current_session_id,
    logout_request_id,
    'SUCCESS',
    '{}'::JSONB,
    logout_ip_address,
    logout_user_agent
  );

  RETURN TRUE;
END
$function$;

-- Function access matrix
REVOKE EXECUTE ON FUNCTION metas.bootstrap_platform_admin(TEXT, public.citext, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.authenticate_platform_admin_google(
  TEXT, public.citext, BYTEA, TIMESTAMPTZ, TIMESTAMPTZ, INET, TEXT, UUID
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.resolve_platform_admin_session(BYTEA, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.require_platform_admin_context() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.get_platform_admin_me() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.revoke_platform_admin_session(UUID, INET, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION metas.bootstrap_platform_admin(TEXT, public.citext, TEXT)
  TO metas_migration_runner;
GRANT EXECUTE ON FUNCTION metas.authenticate_platform_admin_google(
  TEXT, public.citext, BYTEA, TIMESTAMPTZ, TIMESTAMPTZ, INET, TEXT, UUID
) TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.resolve_platform_admin_session(BYTEA, INTEGER)
  TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.get_platform_admin_me()
  TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.revoke_platform_admin_session(UUID, INET, TEXT)
  TO metas_platform_admin_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
