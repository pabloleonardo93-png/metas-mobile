import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
CREATE TABLE metas.platform_admin_first_enrollment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL,
  session_id UUID NOT NULL,
  session_token_version BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ NULL,
  approval_expires_at TIMESTAMPTZ NULL,
  consumed_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  CONSTRAINT platform_admin_first_enrollment_requests_admin_fk
    FOREIGN KEY (platform_admin_id)
    REFERENCES metas.platform_admins (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_first_enrollment_requests_session_admin_fk
    FOREIGN KEY (session_id, platform_admin_id)
    REFERENCES metas.platform_admin_sessions (id, platform_admin_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_first_enrollment_requests_token_version_valid
    CHECK (session_token_version >= 0),
  CONSTRAINT platform_admin_first_enrollment_requests_status_valid
    CHECK (status IN ('PENDING', 'APPROVED', 'CONSUMED', 'EXPIRED', 'REVOKED')),
  CONSTRAINT platform_admin_first_enrollment_requests_timestamps_valid CHECK (
    expires_at > created_at
    AND expires_at <= created_at + INTERVAL '15 minutes'
    AND (approved_at IS NULL OR approved_at >= created_at)
    AND (approval_expires_at IS NULL OR (
      approved_at IS NOT NULL
      AND approval_expires_at > approved_at
      AND approval_expires_at <= approved_at + INTERVAL '5 minutes'
    ))
    AND (consumed_at IS NULL OR (
      approved_at IS NOT NULL
      AND approval_expires_at IS NOT NULL
      AND consumed_at BETWEEN approved_at AND approval_expires_at
    ))
    AND (revoked_at IS NULL OR revoked_at >= created_at)
  ),
  CONSTRAINT platform_admin_first_enrollment_requests_state_valid CHECK (
    (status = 'PENDING'
      AND approved_at IS NULL AND approval_expires_at IS NULL
      AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status = 'APPROVED'
      AND approved_at IS NOT NULL AND approval_expires_at IS NOT NULL
      AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status = 'CONSUMED'
      AND approved_at IS NOT NULL AND approval_expires_at IS NOT NULL
      AND consumed_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'EXPIRED' AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND consumed_at IS NULL AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX platform_admin_first_enrollment_requests_active_admin_idx
  ON metas.platform_admin_first_enrollment_requests (platform_admin_id)
  WHERE status IN ('PENDING', 'APPROVED');
CREATE INDEX platform_admin_first_enrollment_requests_session_idx
  ON metas.platform_admin_first_enrollment_requests (session_id, created_at DESC);
CREATE INDEX platform_admin_first_enrollment_requests_status_expiry_idx
  ON metas.platform_admin_first_enrollment_requests (status, expires_at);

ALTER TABLE metas.platform_admin_first_enrollment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_first_enrollment_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_admin_first_enrollment_requests_owner_all
  ON metas.platform_admin_first_enrollment_requests
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);

REVOKE ALL ON TABLE metas.platform_admin_first_enrollment_requests
  FROM PUBLIC, metas_app_runtime, metas_platform_admin_operator, metas_platform_admin_runtime;

ALTER TABLE metas.platform_admin_webauthn_challenges
  ADD COLUMN first_enrollment_request_id UUID NULL,
  ADD CONSTRAINT platform_admin_webauthn_challenges_first_enrollment_request_fk
    FOREIGN KEY (first_enrollment_request_id)
    REFERENCES metas.platform_admin_first_enrollment_requests (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE UNIQUE INDEX platform_admin_webauthn_challenges_first_enrollment_request_unique
  ON metas.platform_admin_webauthn_challenges (first_enrollment_request_id)
  WHERE first_enrollment_request_id IS NOT NULL;

CREATE FUNCTION metas.request_platform_admin_first_enrollment(
  requested_expires_at TIMESTAMPTZ,
  operation_request_id UUID,
  request_ip_address INET,
  request_user_agent TEXT
)
RETURNS TABLE (
  enrollment_request_id UUID,
  request_status TEXT,
  request_expires_at TIMESTAMPTZ,
  approval_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  active_request metas.platform_admin_first_enrollment_requests%ROWTYPE;
  current_admin_id UUID;
  current_session_id UUID;
  current_session_token_version BIGINT;
  current_session_assurance TEXT;
  new_request_id UUID;
BEGIN
  current_admin_id := metas.require_platform_admin_context();
  current_session_id := metas.safe_context_uuid('app.current_platform_admin_session_id');
  IF operation_request_id IS NULL
    OR requested_expires_at <= now()
    OR requested_expires_at > now() + INTERVAL '15 minutes'
    OR (request_user_agent IS NOT NULL AND char_length(request_user_agent) > 512) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FIRST_ENROLLMENT_REQUEST';
  END IF;

  PERFORM 1 FROM metas.platform_admins admin
  WHERE admin.id = current_admin_id AND admin.status = 'ACTIVE'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_CONTEXT_REQUIRED';
  END IF;

  SELECT session.token_version, session.assurance_level
  INTO current_session_token_version, current_session_assurance
  FROM metas.platform_admin_sessions session
  WHERE session.id = current_session_id
    AND session.platform_admin_id = current_admin_id
    AND session.revoked_at IS NULL
    AND session.expires_at > now()
    AND session.idle_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND OR current_session_assurance <> 'GOOGLE_ONLY' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FIRST_ENROLLMENT_NOT_ALLOWED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM metas.platform_admin_webauthn_credentials credential
    WHERE credential.platform_admin_id = current_admin_id
      AND credential.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FIRST_ENROLLMENT_NOT_ALLOWED';
  END IF;

  UPDATE metas.platform_admin_first_enrollment_requests enrollment_request
  SET status = 'EXPIRED'
  WHERE enrollment_request.platform_admin_id = current_admin_id
    AND enrollment_request.status = 'PENDING'
    AND enrollment_request.expires_at <= now();
  UPDATE metas.platform_admin_first_enrollment_requests enrollment_request
  SET status = 'EXPIRED'
  WHERE enrollment_request.platform_admin_id = current_admin_id
    AND enrollment_request.status = 'APPROVED'
    AND enrollment_request.approval_expires_at <= now();

  SELECT enrollment_request.* INTO active_request
  FROM metas.platform_admin_first_enrollment_requests enrollment_request
  WHERE enrollment_request.platform_admin_id = current_admin_id
    AND enrollment_request.session_id = current_session_id
    AND enrollment_request.session_token_version = current_session_token_version
    AND enrollment_request.status IN ('PENDING', 'APPROVED')
  ORDER BY enrollment_request.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN QUERY SELECT active_request.id, active_request.status,
      active_request.expires_at, active_request.approval_expires_at;
    RETURN;
  END IF;

  WITH revoked_request AS (
    UPDATE metas.platform_admin_first_enrollment_requests enrollment_request
    SET status = 'REVOKED', revoked_at = now()
    WHERE enrollment_request.platform_admin_id = current_admin_id
      AND enrollment_request.status IN ('PENDING', 'APPROVED')
    RETURNING enrollment_request.id
  )
  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata, ip_address, user_agent
  )
  SELECT current_admin_id, 'FIRST_ENROLLMENT_REVOKED', 'FIRST_ENROLLMENT_REQUEST',
    revoked_request.id, operation_request_id, 'SUCCESS',
    jsonb_build_object('reason', 'SUPERSEDED_BY_NEW_SESSION'),
    request_ip_address, request_user_agent
  FROM revoked_request;

  INSERT INTO metas.platform_admin_first_enrollment_requests (
    platform_admin_id, session_id, session_token_version, expires_at
  ) VALUES (
    current_admin_id, current_session_id, current_session_token_version, requested_expires_at
  ) RETURNING id INTO new_request_id;

  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata, ip_address, user_agent
  ) VALUES (
    current_admin_id, 'FIRST_ENROLLMENT_REQUESTED', 'FIRST_ENROLLMENT_REQUEST',
    new_request_id, operation_request_id, 'SUCCESS', '{}'::jsonb,
    request_ip_address, request_user_agent
  );

  RETURN QUERY SELECT new_request_id, 'PENDING'::TEXT, requested_expires_at, NULL::TIMESTAMPTZ;
END
$function$;

CREATE FUNCTION metas.get_platform_admin_first_enrollment_request_status(
  requested_enrollment_request_id UUID
)
RETURNS TABLE (
  enrollment_request_id UUID,
  platform_admin_id UUID,
  request_status TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approval_expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog
AS $function$
BEGIN
  IF session_user <> 'metas_platform_admin_operator' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_OPERATOR_REQUIRED';
  END IF;

  RETURN QUERY SELECT enrollment_request.id, enrollment_request.platform_admin_id,
    CASE
      WHEN enrollment_request.status = 'PENDING' AND enrollment_request.expires_at <= now()
        THEN 'EXPIRED'
      WHEN enrollment_request.status = 'APPROVED'
        AND enrollment_request.approval_expires_at <= now() THEN 'EXPIRED'
      ELSE enrollment_request.status
    END,
    enrollment_request.created_at, enrollment_request.expires_at,
    enrollment_request.approved_at, enrollment_request.approval_expires_at,
    enrollment_request.consumed_at, enrollment_request.revoked_at
  FROM metas.platform_admin_first_enrollment_requests enrollment_request
  WHERE enrollment_request.id = requested_enrollment_request_id;
END
$function$;

CREATE FUNCTION metas.approve_platform_admin_first_enrollment(
  requested_enrollment_request_id UUID,
  requested_approval_expires_at TIMESTAMPTZ,
  operation_request_id UUID
)
RETURNS TABLE (
  enrollment_request_id UUID,
  request_status TEXT,
  approved_at TIMESTAMPTZ,
  approval_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_request metas.platform_admin_first_enrollment_requests%ROWTYPE;
  approval_time TIMESTAMPTZ := now();
BEGIN
  IF session_user <> 'metas_platform_admin_operator' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_OPERATOR_REQUIRED';
  END IF;
  IF requested_enrollment_request_id IS NULL
    OR operation_request_id IS NULL
    OR requested_approval_expires_at <= approval_time
    OR requested_approval_expires_at > approval_time + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_FIRST_ENROLLMENT_APPROVAL';
  END IF;

  SELECT enrollment_request.* INTO current_request
  FROM metas.platform_admin_first_enrollment_requests enrollment_request
  WHERE enrollment_request.id = requested_enrollment_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FIRST_ENROLLMENT_REQUEST_NOT_AVAILABLE';
  END IF;

  PERFORM 1 FROM metas.platform_admins admin
  WHERE admin.id = current_request.platform_admin_id AND admin.status = 'ACTIVE'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FIRST_ENROLLMENT_REQUEST_NOT_AVAILABLE';
  END IF;

  SELECT enrollment_request.* INTO current_request
  FROM metas.platform_admin_first_enrollment_requests enrollment_request
  WHERE enrollment_request.id = requested_enrollment_request_id
  FOR UPDATE;

  IF current_request.status = 'APPROVED'
    AND current_request.approval_expires_at > approval_time THEN
    RETURN QUERY SELECT current_request.id, current_request.status,
      current_request.approved_at, current_request.approval_expires_at;
    RETURN;
  END IF;

  IF current_request.status = 'PENDING' AND current_request.expires_at <= approval_time THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FIRST_ENROLLMENT_REQUEST_NOT_AVAILABLE';
  END IF;
  IF current_request.status <> 'PENDING' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'FIRST_ENROLLMENT_REQUEST_NOT_AVAILABLE';
  END IF;

  PERFORM 1 FROM metas.platform_admin_sessions session
  WHERE session.id = current_request.session_id
    AND session.platform_admin_id = current_request.platform_admin_id
    AND session.token_version = current_request.session_token_version
    AND session.assurance_level = 'GOOGLE_ONLY'
    AND session.revoked_at IS NULL
    AND session.expires_at > approval_time
    AND session.idle_expires_at > approval_time
  FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM metas.platform_admin_webauthn_credentials credential
    WHERE credential.platform_admin_id = current_request.platform_admin_id
      AND credential.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FIRST_ENROLLMENT_REQUEST_NOT_AVAILABLE';
  END IF;

  UPDATE metas.platform_admin_first_enrollment_requests enrollment_request
  SET status = 'APPROVED', approved_at = approval_time,
      approval_expires_at = requested_approval_expires_at
  WHERE enrollment_request.id = current_request.id;

  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata
  ) VALUES (
    current_request.platform_admin_id, 'FIRST_ENROLLMENT_APPROVED',
    'FIRST_ENROLLMENT_REQUEST', current_request.id, operation_request_id,
    'SUCCESS', jsonb_build_object('source', 'PLATFORM_ADMIN_OPERATOR_CLI')
  );

  RETURN QUERY SELECT current_request.id, 'APPROVED'::TEXT,
    approval_time, requested_approval_expires_at;
END
$function$;

CREATE OR REPLACE FUNCTION metas.create_platform_admin_webauthn_challenge(
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
  approved_enrollment_request_id UUID;
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

  PERFORM 1 FROM metas.platform_admins admin
  WHERE admin.id = current_admin_id AND admin.status = 'ACTIVE'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_CONTEXT_REQUIRED';
  END IF;

  SELECT session.assurance_level, session.step_up_verified_at, session.token_version
  INTO current_assurance_level, current_step_up_verified_at, current_session_token_version
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

  SELECT count(*)::INTEGER INTO active_credential_count
  FROM metas.platform_admin_webauthn_credentials credential
  WHERE credential.platform_admin_id = current_admin_id
    AND credential.revoked_at IS NULL;

  IF requested_purpose = 'REGISTRATION' THEN
    IF active_credential_count = 0 THEN
      IF current_assurance_level <> 'GOOGLE_ONLY' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FIRST_ENROLLMENT_NOT_ALLOWED';
      END IF;
      SELECT enrollment_request.id INTO approved_enrollment_request_id
      FROM metas.platform_admin_first_enrollment_requests enrollment_request
      WHERE enrollment_request.platform_admin_id = current_admin_id
        AND enrollment_request.session_id = current_session_id
        AND enrollment_request.session_token_version = current_session_token_version
        AND enrollment_request.status = 'APPROVED'
        AND enrollment_request.approval_expires_at > now()
      ORDER BY enrollment_request.approved_at DESC
      LIMIT 1
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501',
          MESSAGE = 'WEBAUTHN_FIRST_ENROLLMENT_APPROVAL_REQUIRED';
      END IF;
      UPDATE metas.platform_admin_first_enrollment_requests
      SET status = 'CONSUMED', consumed_at = now()
      WHERE id = approved_enrollment_request_id;
    ELSIF current_assurance_level <> 'MFA_VERIFIED'
      OR current_step_up_verified_at IS NULL
      OR current_step_up_verified_at <
        now() - make_interval(secs => required_step_up_max_age_seconds) THEN
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
    purpose, challenge_hash, expires_at, first_enrollment_request_id
  ) VALUES (
    current_admin_id, current_session_id, current_session_token_version,
    requested_purpose, new_challenge_hash, challenge_expires_at,
    approved_enrollment_request_id
  ) RETURNING id INTO new_challenge_id;

  IF approved_enrollment_request_id IS NOT NULL THEN
    INSERT INTO metas.platform_admin_audit_events (
      platform_admin_id, action, target_type, target_id, request_id,
      outcome, metadata
    ) VALUES (
      current_admin_id, 'FIRST_ENROLLMENT_CONSUMED', 'FIRST_ENROLLMENT_REQUEST',
      approved_enrollment_request_id, new_challenge_id, 'SUCCESS', '{}'::jsonb
    );
  END IF;

  RETURN new_challenge_id;
END
$function$;

CREATE OR REPLACE FUNCTION metas.register_platform_admin_webauthn_credential(
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
  challenge_first_enrollment_request_id UUID;
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

  SELECT challenge.session_token_version, challenge.first_enrollment_request_id
  INTO expected_session_token_version, challenge_first_enrollment_request_id
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
  IF active_credential_count = 0 THEN
    IF current_assurance <> 'GOOGLE_ONLY'
      OR challenge_first_enrollment_request_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM metas.platform_admin_first_enrollment_requests enrollment_request
        WHERE enrollment_request.id = challenge_first_enrollment_request_id
          AND enrollment_request.platform_admin_id = current_admin_id
          AND enrollment_request.session_id = current_session_id
          AND enrollment_request.session_token_version = current_session_token_version
          AND enrollment_request.status = 'CONSUMED'
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'FIRST_ENROLLMENT_NOT_ALLOWED';
    END IF;
  ELSIF challenge_first_enrollment_request_id IS NOT NULL
    OR current_assurance <> 'MFA_VERIFIED'
    OR current_step_up IS NULL
    OR current_step_up < now() - make_interval(secs => required_step_up_max_age_seconds) THEN
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

  WITH revoked_request AS (
    UPDATE metas.platform_admin_first_enrollment_requests enrollment_request
    SET status = 'REVOKED', revoked_at = verified_at
    WHERE enrollment_request.platform_admin_id = current_admin_id
      AND enrollment_request.status IN ('PENDING', 'APPROVED')
    RETURNING enrollment_request.id
  )
  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata, ip_address, user_agent
  )
  SELECT current_admin_id, 'FIRST_ENROLLMENT_REVOKED', 'FIRST_ENROLLMENT_REQUEST',
    revoked_request.id, registration_request_id, 'SUCCESS',
    jsonb_build_object('reason', 'CREDENTIAL_REGISTERED'),
    registration_ip_address, registration_user_agent
  FROM revoked_request;

  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata, ip_address, user_agent
  ) VALUES (
    current_admin_id, 'WEBAUTHN_CREDENTIAL_REGISTERED', 'WEBAUTHN_CREDENTIAL',
    inserted_credential_id, registration_request_id, 'SUCCESS',
    jsonb_build_object('deviceType', new_device_type, 'backedUp', new_backed_up,
      'controlledFirstEnrollment', challenge_first_enrollment_request_id IS NOT NULL),
    registration_ip_address, registration_user_agent
  );

  RETURN QUERY SELECT inserted_credential_id, 'MFA_VERIFIED'::TEXT,
    verified_at, verified_at;
END
$function$;

REVOKE EXECUTE ON FUNCTION metas.request_platform_admin_first_enrollment(
  TIMESTAMPTZ, UUID, INET, TEXT
) FROM PUBLIC, metas_migration_runner, metas_platform_admin_operator;
REVOKE EXECUTE ON FUNCTION metas.get_platform_admin_first_enrollment_request_status(UUID)
  FROM PUBLIC, metas_app_runtime, metas_migration_runner, metas_platform_admin_runtime;
REVOKE EXECUTE ON FUNCTION metas.approve_platform_admin_first_enrollment(
  UUID, TIMESTAMPTZ, UUID
) FROM PUBLIC, metas_app_runtime, metas_migration_runner, metas_platform_admin_runtime;
REVOKE EXECUTE ON FUNCTION metas.create_platform_admin_webauthn_challenge(
  TEXT, BYTEA, TIMESTAMPTZ, INTEGER
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.register_platform_admin_webauthn_credential(
  UUID, TEXT, BYTEA, BIGINT, TEXT[], TEXT, BOOLEAN, TEXT, BYTEA,
  INTEGER, UUID, INET, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION metas.request_platform_admin_first_enrollment(
  TIMESTAMPTZ, UUID, INET, TEXT
) TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.get_platform_admin_first_enrollment_request_status(UUID)
  TO metas_platform_admin_operator;
GRANT EXECUTE ON FUNCTION metas.approve_platform_admin_first_enrollment(
  UUID, TIMESTAMPTZ, UUID
) TO metas_platform_admin_operator;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
