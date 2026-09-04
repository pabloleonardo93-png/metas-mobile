import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
CREATE TABLE metas.platform_admin_mfa_recovery_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL,
  session_id UUID NOT NULL,
  session_token_version BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ NULL,
  approval_expires_at TIMESTAMPTZ NULL,
  enrollment_started_at TIMESTAMPTZ NULL,
  enrollment_expires_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  new_credential_id UUID NULL,
  CONSTRAINT platform_admin_mfa_recovery_requests_admin_fk
    FOREIGN KEY (platform_admin_id)
    REFERENCES metas.platform_admins (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_mfa_recovery_requests_session_admin_fk
    FOREIGN KEY (session_id, platform_admin_id)
    REFERENCES metas.platform_admin_sessions (id, platform_admin_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_mfa_recovery_requests_credential_fk
    FOREIGN KEY (new_credential_id)
    REFERENCES metas.platform_admin_webauthn_credentials (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT platform_admin_mfa_recovery_requests_token_version_valid
    CHECK (session_token_version >= 0),
  CONSTRAINT platform_admin_mfa_recovery_requests_status_valid CHECK (
    status IN ('PENDING', 'APPROVED', 'ENROLLMENT_STARTED', 'COMPLETED', 'EXPIRED', 'REVOKED')
  ),
  CONSTRAINT platform_admin_mfa_recovery_requests_timestamps_valid CHECK (
    expires_at > created_at
    AND expires_at <= created_at + INTERVAL '15 minutes'
    AND (approved_at IS NULL OR approved_at >= created_at)
    AND (approval_expires_at IS NULL OR (
      approved_at IS NOT NULL
      AND approval_expires_at > approved_at
      AND approval_expires_at <= approved_at + INTERVAL '5 minutes'
    ))
    AND (enrollment_started_at IS NULL OR (
      approved_at IS NOT NULL
      AND approval_expires_at IS NOT NULL
      AND enrollment_started_at BETWEEN approved_at AND approval_expires_at
    ))
    AND (enrollment_expires_at IS NULL OR (
      enrollment_started_at IS NOT NULL
      AND enrollment_expires_at > enrollment_started_at
      AND enrollment_expires_at <= enrollment_started_at + INTERVAL '10 minutes'
    ))
    AND (completed_at IS NULL OR (
      enrollment_started_at IS NOT NULL
      AND enrollment_expires_at IS NOT NULL
      AND completed_at BETWEEN enrollment_started_at AND enrollment_expires_at
    ))
    AND (revoked_at IS NULL OR revoked_at >= created_at)
  ),
  CONSTRAINT platform_admin_mfa_recovery_requests_state_valid CHECK (
    (status = 'PENDING'
      AND approved_at IS NULL AND approval_expires_at IS NULL
      AND enrollment_started_at IS NULL AND enrollment_expires_at IS NULL
      AND completed_at IS NULL AND revoked_at IS NULL AND new_credential_id IS NULL)
    OR (status = 'APPROVED'
      AND approved_at IS NOT NULL AND approval_expires_at IS NOT NULL
      AND enrollment_started_at IS NULL AND enrollment_expires_at IS NULL
      AND completed_at IS NULL AND revoked_at IS NULL AND new_credential_id IS NULL)
    OR (status = 'ENROLLMENT_STARTED'
      AND approved_at IS NOT NULL AND approval_expires_at IS NOT NULL
      AND enrollment_started_at IS NOT NULL AND enrollment_expires_at IS NOT NULL
      AND completed_at IS NULL AND revoked_at IS NULL AND new_credential_id IS NULL)
    OR (status = 'COMPLETED'
      AND approved_at IS NOT NULL AND approval_expires_at IS NOT NULL
      AND enrollment_started_at IS NOT NULL AND enrollment_expires_at IS NOT NULL
      AND completed_at IS NOT NULL AND revoked_at IS NULL AND new_credential_id IS NOT NULL)
    OR (status = 'EXPIRED'
      AND completed_at IS NULL AND revoked_at IS NULL AND new_credential_id IS NULL)
    OR (status = 'REVOKED'
      AND completed_at IS NULL AND revoked_at IS NOT NULL AND new_credential_id IS NULL)
  )
);

CREATE UNIQUE INDEX platform_admin_mfa_recovery_active_admin_idx
  ON metas.platform_admin_mfa_recovery_requests (platform_admin_id)
  WHERE status IN ('PENDING', 'APPROVED', 'ENROLLMENT_STARTED');
CREATE INDEX platform_admin_mfa_recovery_session_idx
  ON metas.platform_admin_mfa_recovery_requests (session_id, created_at DESC);
CREATE INDEX platform_admin_mfa_recovery_status_expiry_idx
  ON metas.platform_admin_mfa_recovery_requests (status, expires_at);

ALTER TABLE metas.platform_admin_mfa_recovery_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_mfa_recovery_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_admin_mfa_recovery_requests_owner_all
  ON metas.platform_admin_mfa_recovery_requests
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);

REVOKE ALL ON TABLE metas.platform_admin_mfa_recovery_requests
  FROM PUBLIC, metas_app_runtime, metas_platform_admin_operator, metas_platform_admin_runtime;

ALTER TABLE metas.platform_admin_webauthn_challenges
  DROP CONSTRAINT platform_admin_webauthn_challenges_purpose_valid,
  ADD CONSTRAINT platform_admin_webauthn_challenges_purpose_valid CHECK (
    purpose IN ('REGISTRATION', 'AUTHENTICATION', 'STEP_UP', 'RECOVERY_ENROLLMENT')
  ),
  ADD COLUMN recovery_request_id UUID NULL,
  ADD CONSTRAINT platform_admin_webauthn_challenges_recovery_request_fk
    FOREIGN KEY (recovery_request_id)
    REFERENCES metas.platform_admin_mfa_recovery_requests (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT platform_admin_webauthn_challenges_recovery_binding_valid CHECK (
    (purpose = 'RECOVERY_ENROLLMENT'
      AND recovery_request_id IS NOT NULL
      AND first_enrollment_request_id IS NULL)
    OR (purpose <> 'RECOVERY_ENROLLMENT' AND recovery_request_id IS NULL)
  );

CREATE UNIQUE INDEX pa_webauthn_challenges_recovery_request_uidx
  ON metas.platform_admin_webauthn_challenges (recovery_request_id)
  WHERE recovery_request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION metas.request_platform_admin_first_enrollment(
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

CREATE FUNCTION metas.has_platform_admin_webauthn_credential_history()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  current_admin_id UUID;
BEGIN
  current_admin_id := metas.require_platform_admin_context();
  RETURN EXISTS (
    SELECT 1 FROM metas.platform_admin_webauthn_credentials credential
    WHERE credential.platform_admin_id = current_admin_id
  );
END
$function$;

CREATE FUNCTION metas.request_platform_admin_mfa_recovery(
  requested_expires_at TIMESTAMPTZ,
  operation_request_id UUID,
  request_ip_address INET,
  request_user_agent TEXT
)
RETURNS TABLE (
  recovery_request_id UUID,
  request_status TEXT,
  request_expires_at TIMESTAMPTZ,
  approval_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  active_request metas.platform_admin_mfa_recovery_requests%ROWTYPE;
  current_admin_id UUID;
  current_session_id UUID;
  current_session_token_version BIGINT;
  current_session_assurance TEXT;
  expired_request_id UUID;
  new_request_id UUID;
BEGIN
  current_admin_id := metas.require_platform_admin_context();
  current_session_id := metas.safe_context_uuid('app.current_platform_admin_session_id');
  IF operation_request_id IS NULL
    OR requested_expires_at <= now()
    OR requested_expires_at > now() + INTERVAL '15 minutes'
    OR (request_user_agent IS NOT NULL AND char_length(request_user_agent) > 512) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MFA_RECOVERY_REQUEST';
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
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFA_RECOVERY_NOT_ALLOWED';
  END IF;

  FOR expired_request_id IN
    UPDATE metas.platform_admin_mfa_recovery_requests recovery_request
    SET status = 'EXPIRED'
    WHERE recovery_request.platform_admin_id = current_admin_id
      AND (
        (recovery_request.status = 'PENDING' AND recovery_request.expires_at <= now())
        OR (recovery_request.status = 'APPROVED'
          AND recovery_request.approval_expires_at <= now())
        OR (recovery_request.status = 'ENROLLMENT_STARTED'
          AND recovery_request.enrollment_expires_at <= now())
      )
    RETURNING recovery_request.id
  LOOP
    INSERT INTO metas.platform_admin_audit_events (
      platform_admin_id, action, target_type, target_id, request_id,
      outcome, metadata, ip_address, user_agent
    ) VALUES (
      current_admin_id, 'MFA_RECOVERY_EXPIRED', 'MFA_RECOVERY_REQUEST',
      expired_request_id, operation_request_id, 'SUCCESS', '{}'::jsonb,
      request_ip_address, request_user_agent
    );
  END LOOP;

  SELECT recovery_request.* INTO active_request
  FROM metas.platform_admin_mfa_recovery_requests recovery_request
  WHERE recovery_request.platform_admin_id = current_admin_id
    AND recovery_request.status IN ('PENDING', 'APPROVED', 'ENROLLMENT_STARTED')
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF active_request.status <> 'ENROLLMENT_STARTED'
      AND active_request.session_id = current_session_id
      AND active_request.session_token_version = current_session_token_version THEN
      RETURN QUERY SELECT active_request.id, active_request.status,
        active_request.expires_at, active_request.approval_expires_at;
      RETURN;
    END IF;
    IF active_request.status <> 'ENROLLMENT_STARTED' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'MFA_RECOVERY_REQUEST_ALREADY_ACTIVE';
    END IF;

    UPDATE metas.platform_admin_webauthn_challenges challenge
    SET consumed_at = COALESCE(challenge.consumed_at, now())
    WHERE challenge.recovery_request_id = active_request.id
      AND challenge.completed_at IS NULL;
    UPDATE metas.platform_admin_mfa_recovery_requests recovery_request
    SET status = 'REVOKED', revoked_at = now()
    WHERE recovery_request.id = active_request.id;
    INSERT INTO metas.platform_admin_audit_events (
      platform_admin_id, action, target_type, target_id, request_id,
      outcome, metadata, ip_address, user_agent
    ) VALUES (
      current_admin_id, 'MFA_RECOVERY_RETRY_REQUESTED', 'MFA_RECOVERY_REQUEST',
      active_request.id, operation_request_id, 'SUCCESS',
      jsonb_build_object('reason', 'RESTART_AFTER_ENROLLMENT_STARTED'),
      request_ip_address, request_user_agent
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM metas.platform_admin_webauthn_credentials credential
    WHERE credential.platform_admin_id = current_admin_id
      AND credential.revoked_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM metas.platform_admin_mfa_recovery_requests recovery_request
    WHERE recovery_request.platform_admin_id = current_admin_id
      AND recovery_request.enrollment_started_at IS NOT NULL
      AND recovery_request.status IN ('EXPIRED', 'REVOKED')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFA_RECOVERY_NOT_ALLOWED';
  END IF;

  INSERT INTO metas.platform_admin_mfa_recovery_requests (
    platform_admin_id, session_id, session_token_version, expires_at
  ) VALUES (
    current_admin_id, current_session_id, current_session_token_version, requested_expires_at
  ) RETURNING id INTO new_request_id;

  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata, ip_address, user_agent
  ) VALUES (
    current_admin_id, 'MFA_RECOVERY_REQUESTED', 'MFA_RECOVERY_REQUEST',
    new_request_id, operation_request_id, 'SUCCESS', '{}'::jsonb,
    request_ip_address, request_user_agent
  );

  RETURN QUERY SELECT new_request_id, 'PENDING'::TEXT, requested_expires_at, NULL::TIMESTAMPTZ;
END
$function$;

CREATE FUNCTION metas.get_platform_admin_mfa_recovery_status(
  requested_recovery_request_id UUID
)
RETURNS TABLE (
  recovery_request_id UUID,
  primary_email TEXT,
  display_name TEXT,
  request_status TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approval_expires_at TIMESTAMPTZ,
  enrollment_started_at TIMESTAMPTZ,
  enrollment_expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
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

  RETURN QUERY SELECT recovery_request.id, admin.primary_email::TEXT, admin.display_name,
    CASE
      WHEN recovery_request.status = 'PENDING' AND recovery_request.expires_at <= now()
        THEN 'EXPIRED'
      WHEN recovery_request.status = 'APPROVED'
        AND recovery_request.approval_expires_at <= now() THEN 'EXPIRED'
      WHEN recovery_request.status = 'ENROLLMENT_STARTED'
        AND recovery_request.enrollment_expires_at <= now() THEN 'EXPIRED'
      ELSE recovery_request.status
    END,
    recovery_request.created_at, recovery_request.expires_at,
    recovery_request.approved_at, recovery_request.approval_expires_at,
    recovery_request.enrollment_started_at, recovery_request.enrollment_expires_at,
    recovery_request.completed_at, recovery_request.revoked_at
  FROM metas.platform_admin_mfa_recovery_requests recovery_request
  JOIN metas.platform_admins admin ON admin.id = recovery_request.platform_admin_id
  WHERE recovery_request.id = requested_recovery_request_id;
END
$function$;

CREATE FUNCTION metas.approve_platform_admin_mfa_recovery(
  requested_recovery_request_id UUID,
  requested_approval_expires_at TIMESTAMPTZ,
  operation_request_id UUID
)
RETURNS TABLE (
  recovery_request_id UUID,
  request_status TEXT,
  approved_at TIMESTAMPTZ,
  approval_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_request metas.platform_admin_mfa_recovery_requests%ROWTYPE;
  approval_time TIMESTAMPTZ := now();
BEGIN
  IF session_user <> 'metas_platform_admin_operator' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_OPERATOR_REQUIRED';
  END IF;
  IF requested_recovery_request_id IS NULL
    OR operation_request_id IS NULL
    OR requested_approval_expires_at <= approval_time
    OR requested_approval_expires_at > approval_time + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MFA_RECOVERY_APPROVAL';
  END IF;

  SELECT recovery_request.* INTO current_request
  FROM metas.platform_admin_mfa_recovery_requests recovery_request
  WHERE recovery_request.id = requested_recovery_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFA_RECOVERY_REQUEST_NOT_AVAILABLE';
  END IF;

  PERFORM 1 FROM metas.platform_admins admin
  WHERE admin.id = current_request.platform_admin_id AND admin.status = 'ACTIVE'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFA_RECOVERY_REQUEST_NOT_AVAILABLE';
  END IF;

  SELECT recovery_request.* INTO current_request
  FROM metas.platform_admin_mfa_recovery_requests recovery_request
  WHERE recovery_request.id = requested_recovery_request_id
  FOR UPDATE;

  IF current_request.status = 'APPROVED'
    AND current_request.approval_expires_at > approval_time THEN
    RETURN QUERY SELECT current_request.id, current_request.status,
      current_request.approved_at, current_request.approval_expires_at;
    RETURN;
  END IF;
  IF current_request.status <> 'PENDING' OR current_request.expires_at <= approval_time THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MFA_RECOVERY_REQUEST_NOT_AVAILABLE';
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
  IF NOT FOUND OR (
    NOT EXISTS (
      SELECT 1 FROM metas.platform_admin_webauthn_credentials credential
      WHERE credential.platform_admin_id = current_request.platform_admin_id
        AND credential.revoked_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM metas.platform_admin_mfa_recovery_requests prior_recovery
      WHERE prior_recovery.platform_admin_id = current_request.platform_admin_id
        AND prior_recovery.id <> current_request.id
        AND prior_recovery.enrollment_started_at IS NOT NULL
        AND prior_recovery.status IN ('EXPIRED', 'REVOKED')
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFA_RECOVERY_REQUEST_NOT_AVAILABLE';
  END IF;

  UPDATE metas.platform_admin_mfa_recovery_requests recovery_request
  SET status = 'APPROVED', approved_at = approval_time,
      approval_expires_at = requested_approval_expires_at
  WHERE recovery_request.id = current_request.id;

  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata
  ) VALUES (
    current_request.platform_admin_id, 'MFA_RECOVERY_APPROVED',
    'MFA_RECOVERY_REQUEST', current_request.id, operation_request_id,
    'SUCCESS', jsonb_build_object('source', 'PLATFORM_ADMIN_OPERATOR_CLI')
  );

  RETURN QUERY SELECT current_request.id, 'APPROVED'::TEXT,
    approval_time, requested_approval_expires_at;
END
$function$;

CREATE FUNCTION metas.create_platform_admin_recovery_webauthn_challenge(
  new_challenge_hash BYTEA,
  challenge_expires_at TIMESTAMPTZ,
  operation_request_id UUID,
  request_ip_address INET,
  request_user_agent TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  approved_request metas.platform_admin_mfa_recovery_requests%ROWTYPE;
  current_admin_id UUID;
  current_session_id UUID;
  current_session_token_version BIGINT;
  new_challenge_id UUID;
  revoked_credential_count INTEGER;
  revoked_session_count INTEGER;
  started_at TIMESTAMPTZ := now();
BEGIN
  current_admin_id := metas.require_platform_admin_context();
  current_session_id := metas.safe_context_uuid('app.current_platform_admin_session_id');
  IF octet_length(new_challenge_hash) <> 32
    OR challenge_expires_at <= started_at
    OR challenge_expires_at > started_at + INTERVAL '10 minutes'
    OR operation_request_id IS NULL
    OR (request_user_agent IS NOT NULL AND char_length(request_user_agent) > 512) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MFA_RECOVERY_CHALLENGE';
  END IF;

  PERFORM 1 FROM metas.platform_admins admin
  WHERE admin.id = current_admin_id AND admin.status = 'ACTIVE'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_CONTEXT_REQUIRED';
  END IF;

  SELECT session.token_version INTO current_session_token_version
  FROM metas.platform_admin_sessions session
  WHERE session.id = current_session_id
    AND session.platform_admin_id = current_admin_id
    AND session.assurance_level = 'GOOGLE_ONLY'
    AND session.revoked_at IS NULL
    AND session.expires_at > started_at
    AND session.idle_expires_at > started_at
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFA_RECOVERY_NOT_ALLOWED';
  END IF;

  SELECT recovery_request.* INTO approved_request
  FROM metas.platform_admin_mfa_recovery_requests recovery_request
  WHERE recovery_request.platform_admin_id = current_admin_id
    AND recovery_request.session_id = current_session_id
    AND recovery_request.session_token_version = current_session_token_version
    AND recovery_request.status = 'APPROVED'
    AND recovery_request.approval_expires_at > started_at
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFA_RECOVERY_APPROVAL_REQUIRED';
  END IF;

  UPDATE metas.platform_admin_sessions session
  SET revoked_at = started_at
  WHERE session.platform_admin_id = current_admin_id
    AND session.id <> current_session_id
    AND session.revoked_at IS NULL;
  GET DIAGNOSTICS revoked_session_count = ROW_COUNT;

  UPDATE metas.platform_admin_webauthn_credentials credential
  SET revoked_at = started_at
  WHERE credential.platform_admin_id = current_admin_id
    AND credential.revoked_at IS NULL;
  GET DIAGNOSTICS revoked_credential_count = ROW_COUNT;
  IF revoked_credential_count = 0 AND NOT EXISTS (
    SELECT 1 FROM metas.platform_admin_mfa_recovery_requests prior_recovery
    WHERE prior_recovery.platform_admin_id = current_admin_id
      AND prior_recovery.id <> approved_request.id
      AND prior_recovery.enrollment_started_at IS NOT NULL
      AND prior_recovery.status IN ('EXPIRED', 'REVOKED')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFA_RECOVERY_NOT_ALLOWED';
  END IF;

  UPDATE metas.platform_admin_webauthn_challenges challenge
  SET consumed_at = started_at
  WHERE challenge.platform_admin_id = current_admin_id
    AND challenge.consumed_at IS NULL
    AND challenge.expires_at > started_at;

  UPDATE metas.platform_admin_mfa_recovery_requests recovery_request
  SET status = 'ENROLLMENT_STARTED', enrollment_started_at = started_at,
      enrollment_expires_at = challenge_expires_at
  WHERE recovery_request.id = approved_request.id;

  INSERT INTO metas.platform_admin_webauthn_challenges (
    platform_admin_id, session_id, session_token_version, purpose,
    challenge_hash, expires_at, recovery_request_id
  ) VALUES (
    current_admin_id, current_session_id, current_session_token_version,
    'RECOVERY_ENROLLMENT', new_challenge_hash, challenge_expires_at, approved_request.id
  ) RETURNING id INTO new_challenge_id;

  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata, ip_address, user_agent
  ) VALUES
    (current_admin_id, 'MFA_RECOVERY_STARTED', 'MFA_RECOVERY_REQUEST',
      approved_request.id, operation_request_id, 'SUCCESS', '{}'::jsonb,
      request_ip_address, request_user_agent),
    (current_admin_id, 'MFA_RECOVERY_CREDENTIALS_REVOKED', 'MFA_RECOVERY_REQUEST',
      approved_request.id, operation_request_id, 'SUCCESS',
      jsonb_build_object('count', revoked_credential_count),
      request_ip_address, request_user_agent),
    (current_admin_id, 'MFA_RECOVERY_SESSIONS_REVOKED', 'MFA_RECOVERY_REQUEST',
      approved_request.id, operation_request_id, 'SUCCESS',
      jsonb_build_object('count', revoked_session_count),
      request_ip_address, request_user_agent);

  RETURN new_challenge_id;
END
$function$;

CREATE FUNCTION metas.complete_platform_admin_mfa_recovery(
  requested_challenge_id UUID,
  new_credential_id TEXT,
  new_public_key BYTEA,
  new_sign_count BIGINT,
  new_transports TEXT[],
  new_device_type TEXT,
  new_backed_up BOOLEAN,
  new_friendly_name TEXT,
  new_session_token_hash BYTEA,
  operation_request_id UUID,
  request_ip_address INET,
  request_user_agent TEXT
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
  challenge_recovery_request_id UUID;
  current_admin_id UUID;
  current_session_id UUID;
  current_session_token_version BIGINT;
  expected_session_token_version BIGINT;
  inserted_credential_id UUID;
  recovery_request metas.platform_admin_mfa_recovery_requests%ROWTYPE;
  revoked_session_count INTEGER;
  verified_at TIMESTAMPTZ := now();
BEGIN
  current_admin_id := metas.require_platform_admin_context();
  current_session_id := metas.safe_context_uuid('app.current_platform_admin_session_id');
  IF octet_length(new_session_token_hash) <> 32
    OR new_sign_count < 0
    OR new_device_type NOT IN ('singleDevice', 'multiDevice')
    OR (new_device_type = 'singleDevice' AND new_backed_up)
    OR operation_request_id IS NULL
    OR (request_user_agent IS NOT NULL AND char_length(request_user_agent) > 512) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MFA_RECOVERY_COMPLETION';
  END IF;

  PERFORM 1 FROM metas.platform_admins admin
  WHERE admin.id = current_admin_id AND admin.status = 'ACTIVE'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PLATFORM_ADMIN_CONTEXT_REQUIRED';
  END IF;

  SELECT challenge.session_token_version, challenge.recovery_request_id
  INTO expected_session_token_version, challenge_recovery_request_id
  FROM metas.platform_admin_webauthn_challenges challenge
  WHERE challenge.id = requested_challenge_id
    AND challenge.platform_admin_id = current_admin_id
    AND challenge.session_id = current_session_id
    AND challenge.purpose = 'RECOVERY_ENROLLMENT'
    AND challenge.consumed_at IS NOT NULL
    AND challenge.completed_at IS NULL
    AND challenge.expires_at > verified_at
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'WEBAUTHN_CHALLENGE_NOT_AVAILABLE';
  END IF;

  SELECT session.token_version INTO current_session_token_version
  FROM metas.platform_admin_sessions session
  WHERE session.id = current_session_id
    AND session.platform_admin_id = current_admin_id
    AND session.assurance_level = 'GOOGLE_ONLY'
    AND session.revoked_at IS NULL
    AND session.expires_at > verified_at
    AND session.idle_expires_at > verified_at
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFA_RECOVERY_NOT_ALLOWED';
  END IF;
  IF current_session_token_version <> expected_session_token_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'WEBAUTHN_SESSION_ROTATED';
  END IF;

  SELECT recovery.* INTO recovery_request
  FROM metas.platform_admin_mfa_recovery_requests recovery
  WHERE recovery.id = challenge_recovery_request_id
    AND recovery.platform_admin_id = current_admin_id
    AND recovery.session_id = current_session_id
    AND recovery.session_token_version = current_session_token_version
    AND recovery.status = 'ENROLLMENT_STARTED'
    AND recovery.enrollment_expires_at > verified_at
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFA_RECOVERY_NOT_ALLOWED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM metas.platform_admin_webauthn_credentials credential
    WHERE credential.platform_admin_id = current_admin_id
      AND credential.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MFA_RECOVERY_NOT_ALLOWED';
  END IF;

  INSERT INTO metas.platform_admin_webauthn_credentials (
    platform_admin_id, credential_id, public_key, sign_count, transports,
    device_type, backed_up, friendly_name
  ) VALUES (
    current_admin_id, new_credential_id, new_public_key, new_sign_count,
    new_transports, new_device_type, new_backed_up,
    NULLIF(btrim(new_friendly_name), '')
  ) RETURNING id INTO inserted_credential_id;

  UPDATE metas.platform_admin_sessions session
  SET revoked_at = verified_at
  WHERE session.platform_admin_id = current_admin_id
    AND session.id <> current_session_id
    AND session.revoked_at IS NULL;
  GET DIAGNOSTICS revoked_session_count = ROW_COUNT;

  UPDATE metas.platform_admin_sessions session
  SET token_hash = new_session_token_hash,
      token_version = session.token_version + 1,
      assurance_level = 'MFA_VERIFIED',
      mfa_verified_at = verified_at,
      step_up_verified_at = verified_at,
      last_seen_at = verified_at
  WHERE session.id = current_session_id;

  UPDATE metas.platform_admin_webauthn_challenges
  SET completed_at = verified_at
  WHERE id = requested_challenge_id;

  UPDATE metas.platform_admin_mfa_recovery_requests recovery
  SET status = 'COMPLETED', completed_at = verified_at,
      new_credential_id = inserted_credential_id
  WHERE recovery.id = recovery_request.id;

  INSERT INTO metas.platform_admin_audit_events (
    platform_admin_id, action, target_type, target_id, request_id,
    outcome, metadata, ip_address, user_agent
  ) VALUES (
    current_admin_id, 'MFA_RECOVERY_COMPLETED', 'MFA_RECOVERY_REQUEST',
    recovery_request.id, operation_request_id, 'SUCCESS',
    jsonb_build_object('deviceType', new_device_type, 'backedUp', new_backed_up,
      'additionalSessionsRevoked', revoked_session_count),
    request_ip_address, request_user_agent
  );

  RETURN QUERY SELECT inserted_credential_id, 'MFA_VERIFIED'::TEXT,
    verified_at, verified_at;
END
$function$;

CREATE OR REPLACE FUNCTION metas.record_platform_admin_webauthn_failure(
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
      WHEN 'RECOVERY_ENROLLMENT' THEN 'MFA_RECOVERY_ENROLLMENT_FAILURE'
      WHEN 'STEP_UP' THEN 'WEBAUTHN_STEP_UP_FAILURE'
      ELSE 'WEBAUTHN_AUTHENTICATION_FAILURE' END,
    NULL, NULL, failure_request_id, 'DENIED',
    jsonb_build_object('reason', 'VERIFICATION_FAILED'),
    failure_ip_address, failure_user_agent
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION metas.request_platform_admin_mfa_recovery(
  TIMESTAMPTZ, UUID, INET, TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.has_platform_admin_webauthn_credential_history() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.get_platform_admin_mfa_recovery_status(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.approve_platform_admin_mfa_recovery(
  UUID, TIMESTAMPTZ, UUID
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.create_platform_admin_recovery_webauthn_challenge(
  BYTEA, TIMESTAMPTZ, UUID, INET, TEXT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.complete_platform_admin_mfa_recovery(
  UUID, TEXT, BYTEA, BIGINT, TEXT[], TEXT, BOOLEAN, TEXT, BYTEA, UUID, INET, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION metas.request_platform_admin_mfa_recovery(
  TIMESTAMPTZ, UUID, INET, TEXT
) TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.has_platform_admin_webauthn_credential_history()
  TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.create_platform_admin_recovery_webauthn_challenge(
  BYTEA, TIMESTAMPTZ, UUID, INET, TEXT
) TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.complete_platform_admin_mfa_recovery(
  UUID, TEXT, BYTEA, BIGINT, TEXT[], TEXT, BOOLEAN, TEXT, BYTEA, UUID, INET, TEXT
) TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.get_platform_admin_mfa_recovery_status(UUID)
  TO metas_platform_admin_operator;
GRANT EXECUTE ON FUNCTION metas.approve_platform_admin_mfa_recovery(
  UUID, TIMESTAMPTZ, UUID
) TO metas_platform_admin_operator;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
