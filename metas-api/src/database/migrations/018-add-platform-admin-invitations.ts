import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
CREATE TABLE metas.platform_admin_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  email public.citext NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ NOT NULL,
  created_by_platform_admin_id UUID NOT NULL REFERENCES metas.platform_admins(id) ON DELETE RESTRICT,
  accepted_platform_admin_id UUID NULL REFERENCES metas.platform_admins(id) ON DELETE RESTRICT,
  cancelled_by_platform_admin_id UUID NULL REFERENCES metas.platform_admins(id) ON DELETE RESTRICT,
  accepted_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_invitations_display_name_valid CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 160),
  CONSTRAINT platform_admin_invitations_email_valid CHECK (
    char_length(email::TEXT) BETWEEN 3 AND 320
    AND email::TEXT = lower(btrim(email::TEXT))
    AND email::TEXT ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  CONSTRAINT platform_admin_invitations_status_valid CHECK (status IN ('PENDING','ACCEPTED','CANCELLED','EXPIRED')),
  CONSTRAINT platform_admin_invitations_state_valid CHECK (
    (status = 'PENDING' AND accepted_platform_admin_id IS NULL AND accepted_at IS NULL AND cancelled_by_platform_admin_id IS NULL AND cancelled_at IS NULL)
    OR (status = 'ACCEPTED' AND accepted_platform_admin_id IS NOT NULL AND accepted_at IS NOT NULL AND cancelled_by_platform_admin_id IS NULL AND cancelled_at IS NULL)
    OR (status = 'CANCELLED' AND accepted_platform_admin_id IS NULL AND accepted_at IS NULL AND cancelled_by_platform_admin_id IS NOT NULL AND cancelled_at IS NOT NULL)
    OR (status = 'EXPIRED' AND accepted_platform_admin_id IS NULL AND accepted_at IS NULL AND cancelled_by_platform_admin_id IS NULL AND cancelled_at IS NULL)
  ),
  CONSTRAINT platform_admin_invitations_timestamps_valid CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX platform_admin_invitations_pending_email_idx
  ON metas.platform_admin_invitations(email) WHERE status='PENDING';
CREATE INDEX platform_admin_invitations_status_expiry_idx
  ON metas.platform_admin_invitations(status,expires_at);
CREATE TRIGGER platform_admin_invitations_set_updated_at
  BEFORE UPDATE ON metas.platform_admin_invitations
  FOR EACH ROW EXECUTE FUNCTION metas.set_updated_at();
ALTER TABLE metas.platform_admin_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.platform_admin_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_admin_invitations_owner_all ON metas.platform_admin_invitations
  FOR ALL TO metas_migration_owner USING(TRUE) WITH CHECK(TRUE);
REVOKE ALL ON TABLE metas.platform_admin_invitations FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_runtime,metas_platform_admin_operator;

ALTER TABLE metas.platform_admin_first_enrollment_requests
  ADD COLUMN approved_by_platform_admin_id UUID NULL REFERENCES metas.platform_admins(id) ON DELETE RESTRICT;

CREATE FUNCTION metas.require_platform_admin_step_up_context(minimum_verified_at TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE admin_id UUID; current_session UUID;
BEGIN
  admin_id := metas.require_platform_management_context();
  current_session := metas.safe_context_uuid('app.current_platform_admin_session_id');
  IF minimum_verified_at IS NULL OR minimum_verified_at > now()
    OR NOT EXISTS (
      SELECT 1 FROM metas.platform_admin_sessions s
      WHERE s.id=current_session AND s.platform_admin_id=admin_id
        AND s.assurance_level='MFA_VERIFIED' AND s.revoked_at IS NULL
        AND s.expires_at>now() AND s.idle_expires_at>now()
        AND s.step_up_verified_at IS NOT NULL
        AND s.step_up_verified_at>=minimum_verified_at
        AND s.step_up_verified_at>=now()-interval '5 minutes'
        AND s.step_up_verified_at<=now()
    ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_STEP_UP_REQUIRED';
  END IF;
  RETURN admin_id;
END $fn$;

CREATE FUNCTION metas.read_platform_admin_access()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog AS $fn$
DECLARE result JSONB;
BEGIN
  PERFORM metas.require_platform_management_context();
  SELECT jsonb_build_object('items',COALESCE(jsonb_agg(row_data ORDER BY sort_name,sort_id),'[]'::jsonb)) INTO result
  FROM (
    SELECT lower(a.display_name) sort_name,a.id sort_id,jsonb_build_object(
      'id',a.id,'displayName',a.display_name,'email',a.primary_email::TEXT,
      'status',CASE WHEN a.status='DISABLED' THEN 'DISABLED'
        WHEN EXISTS(SELECT 1 FROM metas.platform_admin_webauthn_credentials c WHERE c.platform_admin_id=a.id AND c.revoked_at IS NULL) THEN 'ACTIVE'
        ELSE 'AWAITING_DEVICE_APPROVAL' END,
      'invitationId',NULL::UUID,'enrollmentRequestId',(
        SELECT r.id FROM metas.platform_admin_first_enrollment_requests r
        WHERE r.platform_admin_id=a.id AND r.status='PENDING' AND r.expires_at>now()
        ORDER BY r.created_at DESC LIMIT 1
      ),'lastAccessAt',(
        SELECT max(i.last_sign_in_at) FROM metas.platform_admin_identities i WHERE i.platform_admin_id=a.id
      )) row_data
    FROM metas.platform_admins a
    UNION ALL
    SELECT lower(i.display_name),i.id,jsonb_build_object(
      'id',i.id,'displayName',i.display_name,'email',i.email::TEXT,
      'status','AWAITING_FIRST_ACCESS','invitationId',i.id,
      'enrollmentRequestId',NULL::UUID,'lastAccessAt',NULL::TIMESTAMPTZ
    )
    FROM metas.platform_admin_invitations i WHERE i.status='PENDING' AND i.expires_at>now()
  ) entries;
  RETURN result;
END $fn$;

CREATE FUNCTION metas.create_platform_admin_invitation(
  requested_display_name TEXT,requested_email public.citext,requested_expires_at TIMESTAMPTZ,
  minimum_step_up_at TIMESTAMPTZ,operation_request_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor_id UUID; invitation_id UUID; normalized_name TEXT; normalized_email public.citext;
BEGIN
  actor_id:=metas.require_platform_admin_step_up_context(minimum_step_up_at);
  normalized_name:=btrim(requested_display_name);
  normalized_email:=lower(btrim(requested_email::TEXT))::public.citext;
  IF requested_display_name IS NULL OR requested_email IS NULL OR requested_expires_at IS NULL
    OR minimum_step_up_at IS NULL OR operation_request_id IS NULL
    OR char_length(normalized_name) NOT BETWEEN 2 AND 160
    OR char_length(normalized_email::TEXT) NOT BETWEEN 3 AND 320
    OR normalized_email::TEXT !~ '^[^@[:space:]]+@[^@[:space:]]+$'
    OR requested_expires_at<=now() OR requested_expires_at>now()+interval '7 days 5 minutes' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PLATFORM_ADMIN_ACCESS_INVALID_INPUT';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(normalized_email::TEXT));
  UPDATE metas.platform_admin_invitations SET status='EXPIRED',updated_at=now()
    WHERE email=normalized_email AND status='PENDING' AND expires_at<=now();
  IF EXISTS(SELECT 1 FROM metas.platform_admins WHERE primary_email=normalized_email) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PLATFORM_ADMIN_ACCESS_ALREADY_EXISTS';
  END IF;
  IF EXISTS(SELECT 1 FROM metas.platform_admin_invitations WHERE email=normalized_email AND status='PENDING') THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PLATFORM_ADMIN_INVITATION_ALREADY_PENDING';
  END IF;
  INSERT INTO metas.platform_admin_invitations(display_name,email,expires_at,created_by_platform_admin_id)
    VALUES(normalized_name,normalized_email,requested_expires_at,actor_id) RETURNING id INTO invitation_id;
  INSERT INTO metas.platform_admin_audit_events(platform_admin_id,action,target_type,target_id,request_id,outcome,metadata)
    VALUES(actor_id,'PLATFORM_ADMIN_INVITATION_CREATED','PLATFORM_ADMIN_INVITATION',invitation_id,operation_request_id,'SUCCESS','{}'::jsonb);
  RETURN invitation_id;
END $fn$;

CREATE FUNCTION metas.cancel_platform_admin_invitation(
  requested_invitation_id UUID,minimum_step_up_at TIMESTAMPTZ,operation_request_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor_id UUID; invitation metas.platform_admin_invitations%ROWTYPE;
BEGIN
  actor_id:=metas.require_platform_admin_step_up_context(minimum_step_up_at);
  IF requested_invitation_id IS NULL OR minimum_step_up_at IS NULL OR operation_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PLATFORM_ADMIN_ACCESS_INVALID_INPUT';
  END IF;
  SELECT * INTO invitation FROM metas.platform_admin_invitations WHERE id=requested_invitation_id FOR UPDATE;
  IF NOT FOUND OR invitation.status<>'PENDING' OR invitation.expires_at<=now() THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PLATFORM_ADMIN_INVITATION_NOT_AVAILABLE';
  END IF;
  UPDATE metas.platform_admin_invitations SET status='CANCELLED',cancelled_at=now(),cancelled_by_platform_admin_id=actor_id,updated_at=now()
    WHERE id=invitation.id;
  INSERT INTO metas.platform_admin_audit_events(platform_admin_id,action,target_type,target_id,request_id,outcome,metadata)
    VALUES(actor_id,'PLATFORM_ADMIN_INVITATION_CANCELLED','PLATFORM_ADMIN_INVITATION',invitation.id,operation_request_id,'SUCCESS','{}'::jsonb);
  RETURN invitation.id;
END $fn$;

CREATE FUNCTION metas.approve_platform_admin_first_enrollment_by_admin(
  requested_enrollment_request_id UUID,requested_approval_expires_at TIMESTAMPTZ,
  minimum_step_up_at TIMESTAMPTZ,operation_request_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor_id UUID; current_request metas.platform_admin_first_enrollment_requests%ROWTYPE; approval_time TIMESTAMPTZ:=now();
BEGIN
  actor_id:=metas.require_platform_admin_step_up_context(minimum_step_up_at);
  IF requested_enrollment_request_id IS NULL OR requested_approval_expires_at IS NULL
    OR minimum_step_up_at IS NULL OR operation_request_id IS NULL
    OR requested_approval_expires_at<=approval_time OR requested_approval_expires_at>approval_time+interval '5 minutes' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PLATFORM_ADMIN_ACCESS_INVALID_INPUT';
  END IF;
  SELECT * INTO current_request FROM metas.platform_admin_first_enrollment_requests
    WHERE id=requested_enrollment_request_id FOR UPDATE;
  IF NOT FOUND OR current_request.status<>'PENDING' OR current_request.expires_at<=approval_time THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FIRST_ENROLLMENT_REQUEST_NOT_AVAILABLE';
  END IF;
  IF current_request.platform_admin_id=actor_id THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_SELF_APPROVAL_FORBIDDEN';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM metas.platform_admin_sessions s
    WHERE s.id=current_request.session_id AND s.platform_admin_id=current_request.platform_admin_id
      AND s.token_version=current_request.session_token_version AND s.assurance_level='GOOGLE_ONLY'
      AND s.revoked_at IS NULL AND s.expires_at>approval_time AND s.idle_expires_at>approval_time
  ) OR EXISTS(
    SELECT 1 FROM metas.platform_admin_webauthn_credentials c
    WHERE c.platform_admin_id=current_request.platform_admin_id AND c.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FIRST_ENROLLMENT_REQUEST_NOT_AVAILABLE';
  END IF;
  UPDATE metas.platform_admin_first_enrollment_requests SET status='APPROVED',approved_at=approval_time,
    approval_expires_at=requested_approval_expires_at,approved_by_platform_admin_id=actor_id
    WHERE id=current_request.id;
  INSERT INTO metas.platform_admin_audit_events(platform_admin_id,action,target_type,target_id,request_id,outcome,metadata)
    VALUES(actor_id,'FIRST_ENROLLMENT_APPROVED','FIRST_ENROLLMENT_REQUEST',current_request.id,operation_request_id,'SUCCESS',
      jsonb_build_object('source','PLATFORM_ADMIN_PANEL','targetPlatformAdminId',current_request.platform_admin_id));
  RETURN current_request.id;
END $fn$;

CREATE OR REPLACE FUNCTION metas.authenticate_platform_admin_google(
  google_subject TEXT,verified_email public.citext,new_token_hash BYTEA,
  absolute_expires_at TIMESTAMPTZ,inactivity_expires_at TIMESTAMPTZ,
  login_ip_address INET,login_user_agent TEXT,login_request_id UUID
) RETURNS TABLE(platform_admin_id UUID,session_id UUID,display_name TEXT,primary_email TEXT,assurance_level TEXT,expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE authenticated_admin_id UUID; authenticated_display_name TEXT; authenticated_identity_id UUID;
  authenticated_primary_email public.citext; new_session_id UUID; normalized_observed_email public.citext;
  invitation metas.platform_admin_invitations%ROWTYPE;
BEGIN
  normalized_observed_email:=lower(btrim(verified_email::TEXT))::public.citext;
  IF google_subject IS NULL OR verified_email IS NULL OR new_token_hash IS NULL
    OR absolute_expires_at IS NULL OR inactivity_expires_at IS NULL OR login_request_id IS NULL
    OR char_length(google_subject) NOT BETWEEN 1 AND 255 OR char_length(normalized_observed_email::TEXT) NOT BETWEEN 3 AND 320
    OR normalized_observed_email::TEXT !~ '^[^@[:space:]]+@[^@[:space:]]+$' OR octet_length(new_token_hash)<>32
    OR absolute_expires_at<=now() OR inactivity_expires_at<=now() OR inactivity_expires_at>absolute_expires_at
    OR (login_user_agent IS NOT NULL AND char_length(login_user_agent)>512) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PLATFORM_ADMIN_LOGIN';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('platform-admin-google:'||google_subject));
  PERFORM pg_advisory_xact_lock(hashtext(normalized_observed_email::TEXT));
  SELECT a.id,a.display_name,a.primary_email,i.id INTO authenticated_admin_id,authenticated_display_name,authenticated_primary_email,authenticated_identity_id
    FROM metas.platform_admin_identities i JOIN metas.platform_admins a ON a.id=i.platform_admin_id
    WHERE i.provider='GOOGLE' AND i.provider_subject=google_subject AND i.disabled_at IS NULL AND a.status='ACTIVE'
    FOR UPDATE OF a,i;
  IF NOT FOUND THEN
    SELECT candidate.* INTO invitation FROM metas.platform_admin_invitations candidate
      WHERE candidate.email=normalized_observed_email AND candidate.status='PENDING'
        AND candidate.expires_at>now() FOR UPDATE;
    IF NOT FOUND OR EXISTS(
      SELECT 1 FROM metas.platform_admin_identities existing_identity
      WHERE existing_identity.provider='GOOGLE' AND existing_identity.provider_subject=google_subject
    ) OR EXISTS(
      SELECT 1 FROM metas.platform_admins existing_admin
      WHERE existing_admin.primary_email=normalized_observed_email
    ) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_ACCESS_DENIED';
    END IF;
    INSERT INTO metas.platform_admins AS new_admin(display_name,primary_email)
      VALUES(invitation.display_name,normalized_observed_email)
      RETURNING new_admin.id,new_admin.display_name,new_admin.primary_email
      INTO authenticated_admin_id,authenticated_display_name,authenticated_primary_email;
    INSERT INTO metas.platform_admin_identities(platform_admin_id,provider,provider_subject,observed_email,provider_verified_at,last_sign_in_at)
      VALUES(authenticated_admin_id,'GOOGLE',google_subject,normalized_observed_email,now(),now()) RETURNING id INTO authenticated_identity_id;
    UPDATE metas.platform_admin_invitations SET status='ACCEPTED',accepted_platform_admin_id=authenticated_admin_id,accepted_at=now(),updated_at=now()
      WHERE id=invitation.id;
    INSERT INTO metas.platform_admin_audit_events(platform_admin_id,action,target_type,target_id,request_id,outcome,metadata,ip_address,user_agent)
      VALUES(authenticated_admin_id,'PLATFORM_ADMIN_INVITATION_ACCEPTED','PLATFORM_ADMIN_INVITATION',invitation.id,login_request_id,'SUCCESS','{}'::jsonb,login_ip_address,login_user_agent);
  ELSE
    IF normalized_observed_email IS DISTINCT FROM authenticated_primary_email
      AND EXISTS(
        SELECT 1 FROM metas.platform_admin_invitations active_invitation
        WHERE active_invitation.email=normalized_observed_email
          AND active_invitation.status='PENDING' AND active_invitation.expires_at>now()
      ) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_ACCESS_DENIED';
    END IF;
    UPDATE metas.platform_admin_identities SET observed_email=normalized_observed_email,last_sign_in_at=now() WHERE id=authenticated_identity_id;
  END IF;
  INSERT INTO metas.platform_admin_sessions(platform_admin_id,identity_id,token_hash,assurance_level,expires_at,idle_expires_at,ip_address,user_agent)
    VALUES(authenticated_admin_id,authenticated_identity_id,new_token_hash,'GOOGLE_ONLY',absolute_expires_at,inactivity_expires_at,login_ip_address,login_user_agent)
    RETURNING id INTO new_session_id;
  INSERT INTO metas.platform_admin_audit_events(platform_admin_id,action,target_type,target_id,request_id,outcome,metadata,ip_address,user_agent)
    VALUES(authenticated_admin_id,'PLATFORM_ADMIN_LOGIN','PLATFORM_ADMIN_SESSION',new_session_id,login_request_id,'SUCCESS',
      jsonb_build_object('assuranceLevel','GOOGLE_ONLY'),login_ip_address,login_user_agent);
  RETURN QUERY SELECT authenticated_admin_id,new_session_id,authenticated_display_name,authenticated_primary_email::TEXT,'GOOGLE_ONLY'::TEXT,absolute_expires_at;
END $fn$;

REVOKE ALL ON FUNCTION metas.require_platform_admin_step_up_context(TIMESTAMPTZ) FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_runtime,metas_platform_admin_operator;
REVOKE ALL ON FUNCTION metas.read_platform_admin_access() FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_runtime,metas_platform_admin_operator;
REVOKE ALL ON FUNCTION metas.create_platform_admin_invitation(TEXT,public.citext,TIMESTAMPTZ,TIMESTAMPTZ,UUID) FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_runtime,metas_platform_admin_operator;
REVOKE ALL ON FUNCTION metas.cancel_platform_admin_invitation(UUID,TIMESTAMPTZ,UUID) FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_runtime,metas_platform_admin_operator;
REVOKE ALL ON FUNCTION metas.approve_platform_admin_first_enrollment_by_admin(UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID) FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_runtime,metas_platform_admin_operator;
GRANT EXECUTE ON FUNCTION metas.read_platform_admin_access() TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.create_platform_admin_invitation(TEXT,public.citext,TIMESTAMPTZ,TIMESTAMPTZ,UUID) TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.cancel_platform_admin_invitation(UUID,TIMESTAMPTZ,UUID) TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.approve_platform_admin_first_enrollment_by_admin(UUID,TIMESTAMPTZ,TIMESTAMPTZ,UUID) TO metas_platform_admin_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
