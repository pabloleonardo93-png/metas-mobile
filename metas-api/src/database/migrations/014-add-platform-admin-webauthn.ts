import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
ALTER TABLE metas.platform_admin_sessions
  ADD CONSTRAINT platform_admin_sessions_id_admin_unique
  UNIQUE (id, platform_admin_id),
  ADD COLUMN token_version BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT platform_admin_sessions_token_version_valid CHECK (token_version >= 0);

CREATE TABLE metas.platform_admin_webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL,
  credential_id TEXT NOT NULL,
  public_key BYTEA NOT NULL,
  sign_count BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  device_type TEXT NOT NULL,
  backed_up BOOLEAN NOT NULL,
  friendly_name TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  CONSTRAINT platform_admin_webauthn_credentials_admin_fk FOREIGN KEY (platform_admin_id)
    REFERENCES metas.platform_admins (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_webauthn_credentials_credential_id_unique UNIQUE (credential_id),
  CONSTRAINT platform_admin_webauthn_credentials_credential_id_valid CHECK (
    char_length(credential_id) BETWEEN 16 AND 2048
    AND credential_id ~ '^[A-Za-z0-9_-]+$'
  ),
  CONSTRAINT platform_admin_webauthn_credentials_public_key_valid CHECK (
    octet_length(public_key) BETWEEN 1 AND 4096
  ),
  CONSTRAINT platform_admin_webauthn_credentials_sign_count_valid CHECK (
    sign_count BETWEEN 0 AND 9007199254740991
  ),
  CONSTRAINT platform_admin_webauthn_credentials_transports_valid CHECK (
    cardinality(transports) <= 7
    AND transports <@ ARRAY['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']::TEXT[]
  ),
  CONSTRAINT platform_admin_webauthn_credentials_device_type_valid CHECK (
    device_type IN ('singleDevice', 'multiDevice')
  ),
  CONSTRAINT platform_admin_webauthn_credentials_backup_state_valid CHECK (
    device_type = 'multiDevice' OR backed_up = FALSE
  ),
  CONSTRAINT platform_admin_webauthn_credentials_friendly_name_valid CHECK (
    friendly_name IS NULL OR char_length(btrim(friendly_name)) BETWEEN 1 AND 100
  ),
  CONSTRAINT platform_admin_webauthn_credentials_timestamps_valid CHECK (
    (last_used_at IS NULL OR last_used_at >= created_at)
    AND (revoked_at IS NULL OR revoked_at >= created_at)
  )
);

CREATE TABLE metas.platform_admin_webauthn_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL,
  session_id UUID NOT NULL,
  session_token_version BIGINT NOT NULL,
  purpose TEXT NOT NULL,
  challenge_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT platform_admin_webauthn_challenges_admin_fk FOREIGN KEY (platform_admin_id)
    REFERENCES metas.platform_admins (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_webauthn_challenges_session_admin_fk
    FOREIGN KEY (session_id, platform_admin_id)
    REFERENCES metas.platform_admin_sessions (id, platform_admin_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_webauthn_challenges_hash_unique UNIQUE (challenge_hash),
  CONSTRAINT platform_admin_webauthn_challenges_purpose_valid CHECK (
    purpose IN ('REGISTRATION', 'AUTHENTICATION', 'STEP_UP')
  ),
  CONSTRAINT platform_admin_webauthn_challenges_hash_valid CHECK (
    octet_length(challenge_hash) = 32
  ),
  CONSTRAINT platform_admin_webauthn_challenges_token_version_valid CHECK (
    session_token_version >= 0
  ),
  CONSTRAINT platform_admin_webauthn_challenges_timestamps_valid CHECK (
    expires_at > created_at
    AND expires_at <= created_at + INTERVAL '10 minutes'
    AND (consumed_at IS NULL OR consumed_at BETWEEN created_at AND expires_at)
    AND (completed_at IS NULL OR (
      consumed_at IS NOT NULL
      AND completed_at BETWEEN consumed_at AND expires_at
    ))
  )
);

CREATE INDEX platform_admin_webauthn_credentials_admin_active_idx
  ON metas.platform_admin_webauthn_credentials (platform_admin_id, created_at, id)
  WHERE revoked_at IS NULL;
CREATE INDEX platform_admin_webauthn_challenges_session_active_idx
  ON metas.platform_admin_webauthn_challenges (session_id, purpose, expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX platform_admin_webauthn_challenges_expiration_idx
  ON metas.platform_admin_webauthn_challenges (expires_at);

ALTER TABLE metas.platform_admin_webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_webauthn_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_webauthn_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_webauthn_challenges FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_admin_webauthn_credentials_owner_all
  ON metas.platform_admin_webauthn_credentials
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY platform_admin_webauthn_challenges_owner_all
  ON metas.platform_admin_webauthn_challenges
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);

REVOKE ALL ON TABLE metas.platform_admin_webauthn_credentials
  FROM PUBLIC, metas_app_runtime, metas_platform_admin_runtime;
REVOKE ALL ON TABLE metas.platform_admin_webauthn_challenges
  FROM PUBLIC, metas_app_runtime, metas_platform_admin_runtime;

CREATE FUNCTION metas.list_platform_admin_webauthn_credentials()
RETURNS TABLE (
  id UUID,
  credential_id TEXT,
  public_key BYTEA,
  sign_count BIGINT,
  transports TEXT[],
  device_type TEXT,
  backed_up BOOLEAN,
  friendly_name TEXT,
  created_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
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
  SELECT credential.id, credential.credential_id, credential.public_key,
    credential.sign_count, credential.transports, credential.device_type,
    credential.backed_up, credential.friendly_name, credential.created_at,
    credential.last_used_at
  FROM metas.platform_admin_webauthn_credentials credential
  WHERE credential.platform_admin_id = current_admin_id
    AND credential.revoked_at IS NULL
  ORDER BY credential.created_at, credential.id;
END
$function$;

CREATE FUNCTION metas.create_platform_admin_webauthn_challenge(
  requested_purpose TEXT,
  new_challenge_hash BYTEA,
  challenge_expires_at TIMESTAMPTZ,
  required_step_up_max_age_seconds INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  active_credential_count INTEGER;
  current_admin_id UUID;
  current_assurance_level TEXT;
  current_session_id UUID;
  current_session_token_version BIGINT;
  current_step_up_verified_at TIMESTAMPTZ;
  new_challenge_id UUID;
BEGIN
  current_admin_id := metas.require_platform_admin_context();
  current_session_id := metas.safe_context_uuid('app.current_platform_admin_session_id');
  IF requested_purpose NOT IN ('REGISTRATION', 'AUTHENTICATION', 'STEP_UP')
    OR octet_length(new_challenge_hash) <> 32
    OR challenge_expires_at <= now()
    OR challenge_expires_at > now() + INTERVAL '10 minutes'
    OR required_step_up_max_age_seconds NOT BETWEEN 60 AND 900 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_WEBAUTHN_CHALLENGE';
  END IF;

  SELECT session.assurance_level, session.step_up_verified_at, session.token_version
  INTO current_assurance_level, current_step_up_verified_at, current_session_token_version
  FROM metas.platform_admin_sessions session
  WHERE session.id = current_session_id
    AND session.platform_admin_id = current_admin_id
  FOR UPDATE;

  SELECT count(*)::INTEGER INTO active_credential_count
  FROM metas.platform_admin_webauthn_credentials credential
  WHERE credential.platform_admin_id = current_admin_id
    AND credential.revoked_at IS NULL;

  IF requested_purpose = 'REGISTRATION' THEN
    IF active_credential_count > 0 AND (
      current_assurance_level <> 'MFA_VERIFIED'
      OR current_step_up_verified_at IS NULL
      OR current_step_up_verified_at <
        now() - make_interval(secs => required_step_up_max_age_seconds)
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WEBAUTHN_STEP_UP_REQUIRED';
    END IF;
  ELSIF requested_purpose = 'AUTHENTICATION' THEN
    IF active_credential_count = 0 OR current_assurance_level <> 'GOOGLE_ONLY' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WEBAUTHN_AUTHENTICATION_NOT_ALLOWED';
    END IF;
  ELSIF active_credential_count = 0 OR current_assurance_level <> 'MFA_VERIFIED' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WEBAUTHN_STEP_UP_NOT_ALLOWED';
  END IF;

  DELETE FROM metas.platform_admin_webauthn_challenges challenge
  WHERE challenge.platform_admin_id = current_admin_id
    AND challenge.expires_at < now() - INTERVAL '1 day';
  UPDATE metas.platform_admin_webauthn_challenges challenge
  SET consumed_at = now()
  WHERE challenge.session_id = current_session_id
    AND challenge.purpose = requested_purpose
    AND challenge.expires_at > now()
    AND challenge.consumed_at IS NULL;

  INSERT INTO metas.platform_admin_webauthn_challenges (
    platform_admin_id, session_id, session_token_version,
    purpose, challenge_hash, expires_at
  ) VALUES (
    current_admin_id, current_session_id, current_session_token_version, requested_purpose,
    new_challenge_hash, challenge_expires_at
  ) RETURNING id INTO new_challenge_id;
  RETURN new_challenge_id;
END
$function$;

CREATE FUNCTION metas.consume_platform_admin_webauthn_challenge(
  requested_challenge_id UUID,
  expected_purpose TEXT
)
RETURNS TABLE (challenge_hash BYTEA, purpose TEXT)
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
  RETURN QUERY
  UPDATE metas.platform_admin_webauthn_challenges challenge
  SET consumed_at = now()
  WHERE challenge.id = requested_challenge_id
    AND challenge.platform_admin_id = current_admin_id
    AND challenge.session_id = current_session_id
    AND challenge.purpose = expected_purpose
    AND challenge.expires_at > now()
    AND challenge.consumed_at IS NULL
  RETURNING challenge.challenge_hash, challenge.purpose;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WEBAUTHN_CHALLENGE_NOT_AVAILABLE';
  END IF;
END
$function$;

CREATE FUNCTION metas.register_platform_admin_webauthn_credential(
  requested_challenge_id UUID,
  new_credential_id TEXT,
  new_public_key BYTEA,
  new_sign_count BIGINT,
  new_transports TEXT[],
  new_device_type TEXT,
  new_backed_up BOOLEAN,
  new_friendly_name TEXT,
  new_session_token_hash BYTEA,
  required_step_up_max_age_seconds INTEGER,
  registration_request_id UUID,
  registration_ip_address INET,
  registration_user_agent TEXT
)
RETURNS TABLE (
  credential_id UUID,
  assurance_level TEXT,
  mfa_verified_at TIMESTAMPTZ,
  step_up_verified_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  active_credential_count INTEGER;
  current_admin_id UUID;
  current_assurance TEXT;
  current_session_id UUID;
  current_session_token_version BIGINT;
  current_step_up TIMESTAMPTZ;
  expected_session_token_version BIGINT;
  inserted_credential_id UUID;
  verified_at TIMESTAMPTZ := now();
BEGIN
  current_admin_id := metas.require_platform_admin_context();
  current_session_id := metas.safe_context_uuid('app.current_platform_admin_session_id');
  IF octet_length(new_session_token_hash) <> 32
    OR required_step_up_max_age_seconds NOT BETWEEN 60 AND 900
    OR registration_request_id IS NULL
    OR (registration_user_agent IS NOT NULL AND char_length(registration_user_agent) > 512) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_WEBAUTHN_REGISTRATION';
  END IF;

  SELECT challenge.session_token_version INTO expected_session_token_version
  FROM metas.platform_admin_webauthn_challenges challenge
  WHERE challenge.id = requested_challenge_id
    AND challenge.platform_admin_id = current_admin_id
    AND challenge.session_id = current_session_id
    AND challenge.purpose = 'REGISTRATION'
    AND challenge.consumed_at IS NOT NULL
    AND challenge.completed_at IS NULL
    AND challenge.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WEBAUTHN_CHALLENGE_NOT_AVAILABLE';
  END IF;

  SELECT session.assurance_level, session.step_up_verified_at, session.token_version
  INTO current_assurance, current_step_up, current_session_token_version
  FROM metas.platform_admin_sessions session
  WHERE session.id = current_session_id
    AND session.platform_admin_id = current_admin_id
    AND session.revoked_at IS NULL
    AND session.expires_at > now()
    AND session.idle_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_CONTEXT_REQUIRED';
  END IF;
  IF current_session_token_version <> expected_session_token_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'WEBAUTHN_SESSION_ROTATED';
  END IF;

  SELECT count(*)::INTEGER INTO active_credential_count
  FROM metas.platform_admin_webauthn_credentials credential
  WHERE credential.platform_admin_id = current_admin_id
    AND credential.revoked_at IS NULL;
  IF active_credential_count > 0 AND (
    current_assurance <> 'MFA_VERIFIED'
    OR current_step_up IS NULL
    OR current_step_up < now() - make_interval(secs => required_step_up_max_age_seconds)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WEBAUTHN_STEP_UP_REQUIRED';
  END IF;

  INSERT INTO metas.platform_admin_webauthn_credentials (
    platform_admin_id, credential_id, public_key, sign_count, transports,
    device_type, backed_up, friendly_name
  ) VALUES (
    current_admin_id, new_credential_id, new_public_key, new_sign_count,
    new_transports, new_device_type, new_backed_up,
    NULLIF(btrim(new_friendly_name), '')
  ) RETURNING id INTO inserted_credential_id;

  UPDATE metas.platform_admin_webauthn_challenges
  SET completed_at = verified_at
  WHERE id = requested_challenge_id;
  UPDATE metas.platform_admin_sessions session
  SET token_hash = new_session_token_hash,
      token_version = session.token_version + 1,
      assurance_level = 'MFA_VERIFIED',
      mfa_verified_at = verified_at,
      step_up_verified_at = verified_at,
      last_seen_at = verified_at
  WHERE id = current_session_id;

  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata, ip_address, user_agent
  ) VALUES (
    current_admin_id, 'WEBAUTHN_CREDENTIAL_REGISTERED', 'WEBAUTHN_CREDENTIAL',
    inserted_credential_id, registration_request_id, 'SUCCESS',
    jsonb_build_object('deviceType', new_device_type, 'backedUp', new_backed_up),
    registration_ip_address, registration_user_agent
  );

  RETURN QUERY SELECT inserted_credential_id, 'MFA_VERIFIED'::TEXT,
    verified_at, verified_at;
END
$function$;

CREATE FUNCTION metas.complete_platform_admin_webauthn_authentication(
  requested_challenge_id UUID,
  requested_credential_id TEXT,
  expected_sign_count BIGINT,
  verified_sign_count BIGINT,
  verified_device_type TEXT,
  verified_backed_up BOOLEAN,
  new_session_token_hash BYTEA,
  authentication_request_id UUID,
  authentication_ip_address INET,
  authentication_user_agent TEXT
)
RETURNS TABLE (
  assurance_level TEXT,
  mfa_verified_at TIMESTAMPTZ,
  step_up_verified_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  challenge_purpose TEXT;
  current_admin_id UUID;
  current_assurance TEXT;
  current_session_id UUID;
  current_session_token_version BIGINT;
  expected_session_token_version BIGINT;
  stored_credential UUID;
  stored_sign_count BIGINT;
  verified_at TIMESTAMPTZ := now();
BEGIN
  current_admin_id := metas.require_platform_admin_context();
  current_session_id := metas.safe_context_uuid('app.current_platform_admin_session_id');
  IF expected_sign_count < 0 OR verified_sign_count < 0
    OR octet_length(new_session_token_hash) <> 32
    OR verified_device_type NOT IN ('singleDevice', 'multiDevice')
    OR (verified_device_type = 'singleDevice' AND verified_backed_up)
    OR authentication_request_id IS NULL
    OR (authentication_user_agent IS NOT NULL AND char_length(authentication_user_agent) > 512) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_WEBAUTHN_AUTHENTICATION';
  END IF;

  SELECT challenge.purpose, challenge.session_token_version
  INTO challenge_purpose, expected_session_token_version
  FROM metas.platform_admin_webauthn_challenges challenge
  WHERE challenge.id = requested_challenge_id
    AND challenge.platform_admin_id = current_admin_id
    AND challenge.session_id = current_session_id
    AND challenge.purpose IN ('AUTHENTICATION', 'STEP_UP')
    AND challenge.consumed_at IS NOT NULL
    AND challenge.completed_at IS NULL
    AND challenge.expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WEBAUTHN_CHALLENGE_NOT_AVAILABLE';
  END IF;

  SELECT session.assurance_level, session.token_version
  INTO current_assurance, current_session_token_version
  FROM metas.platform_admin_sessions session
  WHERE session.id = current_session_id
    AND session.platform_admin_id = current_admin_id
    AND session.revoked_at IS NULL
    AND session.expires_at > now()
    AND session.idle_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND
    OR (challenge_purpose = 'AUTHENTICATION' AND current_assurance <> 'GOOGLE_ONLY')
    OR (challenge_purpose = 'STEP_UP' AND current_assurance <> 'MFA_VERIFIED') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WEBAUTHN_AUTHENTICATION_NOT_ALLOWED';
  END IF;
  IF current_session_token_version <> expected_session_token_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'WEBAUTHN_SESSION_ROTATED';
  END IF;

  SELECT credential.id, credential.sign_count
  INTO stored_credential, stored_sign_count
  FROM metas.platform_admin_webauthn_credentials credential
  WHERE credential.platform_admin_id = current_admin_id
    AND credential.credential_id = requested_credential_id
    AND credential.revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR stored_sign_count <> expected_sign_count THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'WEBAUTHN_CREDENTIAL_STALE';
  END IF;

  UPDATE metas.platform_admin_webauthn_credentials
  SET sign_count = verified_sign_count,
      device_type = verified_device_type,
      backed_up = verified_backed_up,
      last_used_at = verified_at
  WHERE id = stored_credential;
  UPDATE metas.platform_admin_webauthn_challenges
  SET completed_at = verified_at
  WHERE id = requested_challenge_id;
  UPDATE metas.platform_admin_sessions session
  SET token_hash = new_session_token_hash,
      token_version = session.token_version + 1,
      assurance_level = 'MFA_VERIFIED',
      mfa_verified_at = COALESCE(session.mfa_verified_at, verified_at),
      step_up_verified_at = verified_at,
      last_seen_at = verified_at
  WHERE id = current_session_id;

  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata, ip_address, user_agent
  ) VALUES (
    current_admin_id,
    CASE WHEN challenge_purpose = 'STEP_UP'
      THEN 'WEBAUTHN_STEP_UP_SUCCESS'
      ELSE 'WEBAUTHN_AUTHENTICATION_SUCCESS' END,
    'WEBAUTHN_CREDENTIAL', stored_credential, authentication_request_id,
    'SUCCESS', jsonb_build_object('deviceType', verified_device_type,
      'backedUp', verified_backed_up),
    authentication_ip_address, authentication_user_agent
  );

  RETURN QUERY SELECT 'MFA_VERIFIED'::TEXT,
    COALESCE((SELECT session.mfa_verified_at FROM metas.platform_admin_sessions session
      WHERE session.id = current_session_id), verified_at), verified_at;
END
$function$;

CREATE FUNCTION metas.record_platform_admin_webauthn_failure(
  requested_challenge_id UUID,
  failure_request_id UUID,
  failure_ip_address INET,
  failure_user_agent TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  challenge_purpose TEXT;
  current_admin_id UUID;
  current_session_id UUID;
BEGIN
  current_admin_id := metas.require_platform_admin_context();
  current_session_id := metas.safe_context_uuid('app.current_platform_admin_session_id');
  SELECT challenge.purpose INTO challenge_purpose
  FROM metas.platform_admin_webauthn_challenges challenge
  WHERE challenge.id = requested_challenge_id
    AND challenge.platform_admin_id = current_admin_id
    AND challenge.session_id = current_session_id
    AND challenge.consumed_at IS NOT NULL;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata, ip_address, user_agent
  ) VALUES (
    current_admin_id,
    CASE challenge_purpose
      WHEN 'REGISTRATION' THEN 'WEBAUTHN_REGISTRATION_FAILURE'
      WHEN 'STEP_UP' THEN 'WEBAUTHN_STEP_UP_FAILURE'
      ELSE 'WEBAUTHN_AUTHENTICATION_FAILURE' END,
    NULL, NULL, failure_request_id, 'DENIED',
    jsonb_build_object('reason', 'VERIFICATION_FAILED'),
    failure_ip_address, failure_user_agent
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION metas.list_platform_admin_webauthn_credentials() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.create_platform_admin_webauthn_challenge(
  TEXT, BYTEA, TIMESTAMPTZ, INTEGER
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.consume_platform_admin_webauthn_challenge(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.register_platform_admin_webauthn_credential(
  UUID, TEXT, BYTEA, BIGINT, TEXT[], TEXT, BOOLEAN, TEXT, BYTEA,
  INTEGER, UUID, INET, TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.complete_platform_admin_webauthn_authentication(
  UUID, TEXT, BIGINT, BIGINT, TEXT, BOOLEAN, BYTEA, UUID, INET, TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.record_platform_admin_webauthn_failure(
  UUID, UUID, INET, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION metas.list_platform_admin_webauthn_credentials()
  TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.create_platform_admin_webauthn_challenge(
  TEXT, BYTEA, TIMESTAMPTZ, INTEGER
) TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.consume_platform_admin_webauthn_challenge(UUID, TEXT)
  TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.register_platform_admin_webauthn_credential(
  UUID, TEXT, BYTEA, BIGINT, TEXT[], TEXT, BOOLEAN, TEXT, BYTEA,
  INTEGER, UUID, INET, TEXT
) TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.complete_platform_admin_webauthn_authentication(
  UUID, TEXT, BIGINT, BIGINT, TEXT, BOOLEAN, BYTEA, UUID, INET, TEXT
) TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.record_platform_admin_webauthn_failure(
  UUID, UUID, INET, TEXT
) TO metas_platform_admin_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
