import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
ALTER TABLE metas.platform_admins
  DROP CONSTRAINT platform_admins_status_valid,
  ADD COLUMN removed_at TIMESTAMPTZ NULL,
  ADD COLUMN purged_at TIMESTAMPTZ NULL,
  ADD CONSTRAINT platform_admins_status_valid
    CHECK (status IN ('ACTIVE', 'DISABLED', 'REMOVED')),
  ADD CONSTRAINT platform_admins_removal_state_valid CHECK (
    (status = 'REMOVED' AND removed_at IS NOT NULL)
    OR (status <> 'REMOVED' AND purged_at IS NULL)
  ),
  ADD CONSTRAINT platform_admins_removal_timestamps_valid CHECK (
    (removed_at IS NULL OR removed_at >= created_at)
    AND (purged_at IS NULL OR (removed_at IS NOT NULL AND purged_at >= removed_at))
  );

CREATE INDEX platform_admins_removed_retention_idx
  ON metas.platform_admins (removed_at, id)
  WHERE removed_at IS NOT NULL AND purged_at IS NULL;

CREATE FUNCTION metas.purge_expired_platform_admins()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor_id UUID; candidate RECORD; purged_count INTEGER:=0; purge_time TIMESTAMPTZ:=now();
BEGIN
  actor_id:=metas.require_platform_management_context();
  PERFORM pg_advisory_xact_lock(21021);

  FOR candidate IN
    SELECT admin.id,admin.primary_email
    FROM metas.platform_admins admin
    WHERE admin.removed_at<=purge_time-interval '30 days' AND admin.purged_at IS NULL
      AND NOT EXISTS(
        SELECT 1 FROM metas.platform_admin_invitations invitation
        WHERE invitation.email=admin.primary_email AND invitation.status='PENDING'
          AND invitation.expires_at>purge_time
      )
      AND NOT EXISTS(
        SELECT 1 FROM metas.platform_admin_sessions session
        WHERE session.platform_admin_id=admin.id AND session.assurance_level='GOOGLE_ONLY'
          AND session.revoked_at IS NULL AND session.expires_at>purge_time
          AND session.idle_expires_at>purge_time
      )
    ORDER BY admin.removed_at,admin.id
    FOR UPDATE
  LOOP
    DELETE FROM metas.platform_admin_webauthn_challenges WHERE platform_admin_id=candidate.id;
    DELETE FROM metas.platform_admin_first_enrollment_requests WHERE platform_admin_id=candidate.id;
    DELETE FROM metas.platform_admin_mfa_recovery_requests WHERE platform_admin_id=candidate.id;
    DELETE FROM metas.platform_admin_webauthn_credentials WHERE platform_admin_id=candidate.id;
    DELETE FROM metas.platform_admin_sessions WHERE platform_admin_id=candidate.id;
    DELETE FROM metas.platform_admin_identities WHERE platform_admin_id=candidate.id;
    UPDATE metas.platform_admin_invitations
      SET display_name='Administrador removido',
          email=('removed+'||replace(id::TEXT,'-','')||'@invalid.local')::public.citext,
          updated_at=purge_time
      WHERE accepted_platform_admin_id=candidate.id;
    UPDATE metas.platform_admins
      SET status='REMOVED',display_name='Administrador removido',
          primary_email=('removed+'||replace(id::TEXT,'-','')||'@invalid.local')::public.citext,
          purged_at=purge_time,lock_version=lock_version+1
      WHERE id=candidate.id;
    INSERT INTO metas.platform_admin_audit_events(
      platform_admin_id,action,target_type,target_id,request_id,outcome,metadata
    ) VALUES(
      actor_id,'PLATFORM_ADMIN_PURGED','PLATFORM_ADMIN',candidate.id,
      gen_random_uuid(),'SUCCESS',jsonb_build_object('retentionDays',30)
    );
    purged_count:=purged_count+1;
  END LOOP;
  RETURN purged_count;
END $fn$;

CREATE FUNCTION metas.remove_platform_admin_access(
  requested_platform_admin_id UUID,minimum_step_up_at TIMESTAMPTZ,operation_request_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE actor_id UUID; target_admin metas.platform_admins%ROWTYPE; removed_time TIMESTAMPTZ:=now();
BEGIN
  IF requested_platform_admin_id IS NULL OR minimum_step_up_at IS NULL OR operation_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PLATFORM_ADMIN_ACCESS_INVALID_INPUT';
  END IF;
  PERFORM pg_advisory_xact_lock(21021);
  actor_id:=metas.require_platform_admin_step_up_context(minimum_step_up_at);
  SELECT * INTO target_admin FROM metas.platform_admins WHERE id=requested_platform_admin_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='PLATFORM_ADMIN_NOT_FOUND';
  END IF;
  IF target_admin.id=actor_id THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_SELF_REMOVAL_FORBIDDEN';
  END IF;
  IF target_admin.status='REMOVED' THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='PLATFORM_ADMIN_ALREADY_REMOVED';
  END IF;
  IF target_admin.status<>'ACTIVE' OR NOT EXISTS(
    SELECT 1 FROM metas.platform_admin_webauthn_credentials target_credential
    WHERE target_credential.platform_admin_id=target_admin.id
      AND target_credential.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_ACCESS_INVALID_STATE';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM metas.platform_admins active_admin
    WHERE active_admin.status='ACTIVE' AND active_admin.id<>target_admin.id
      AND EXISTS(
        SELECT 1 FROM metas.platform_admin_identities active_identity
        WHERE active_identity.platform_admin_id=active_admin.id
          AND active_identity.disabled_at IS NULL
      )
      AND EXISTS(
        SELECT 1 FROM metas.platform_admin_webauthn_credentials active_credential
        WHERE active_credential.platform_admin_id=active_admin.id
          AND active_credential.revoked_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='LAST_ACTIVE_PLATFORM_ADMIN_REQUIRED';
  END IF;

  UPDATE metas.platform_admins
    SET status='REMOVED',removed_at=removed_time,purged_at=NULL,lock_version=lock_version+1
    WHERE id=target_admin.id;
  UPDATE metas.platform_admin_identities SET disabled_at=COALESCE(disabled_at,removed_time)
    WHERE platform_admin_id=target_admin.id;
  UPDATE metas.platform_admin_sessions SET revoked_at=COALESCE(revoked_at,removed_time)
    WHERE platform_admin_id=target_admin.id;
  UPDATE metas.platform_admin_webauthn_credentials SET revoked_at=COALESCE(revoked_at,removed_time)
    WHERE platform_admin_id=target_admin.id;
  UPDATE metas.platform_admin_webauthn_challenges SET consumed_at=removed_time
    WHERE platform_admin_id=target_admin.id AND consumed_at IS NULL AND expires_at>removed_time;
  UPDATE metas.platform_admin_first_enrollment_requests SET status='REVOKED',revoked_at=removed_time
    WHERE platform_admin_id=target_admin.id AND status IN ('PENDING','APPROVED');
  UPDATE metas.platform_admin_mfa_recovery_requests SET status='REVOKED',revoked_at=removed_time
    WHERE platform_admin_id=target_admin.id AND status IN ('PENDING','APPROVED','ENROLLMENT_STARTED');

  INSERT INTO metas.platform_admin_audit_events(
    platform_admin_id,action,target_type,target_id,request_id,outcome,metadata
  ) VALUES(
    actor_id,'PLATFORM_ADMIN_REMOVED','PLATFORM_ADMIN',target_admin.id,
    operation_request_id,'SUCCESS',jsonb_build_object('previousStatus',target_admin.status)
  );
  RETURN target_admin.id;
END $fn$;

CREATE OR REPLACE FUNCTION metas.read_platform_admin_access()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE result JSONB;
BEGIN
  PERFORM metas.require_platform_management_context();
  PERFORM metas.purge_expired_platform_admins();
  SELECT jsonb_build_object('items',COALESCE(jsonb_agg(row_data ORDER BY sort_name,sort_id),'[]'::jsonb)) INTO result
  FROM (
    SELECT lower(a.display_name) sort_name,a.id sort_id,jsonb_build_object(
      'id',a.id,'displayName',a.display_name,'email',a.primary_email::TEXT,
      'status',CASE WHEN a.status='REMOVED' THEN 'REMOVED' WHEN a.status='DISABLED' THEN 'DISABLED'
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
    WHERE a.purged_at IS NULL AND (
      a.status<>'REMOVED' OR NOT EXISTS(
        SELECT 1 FROM metas.platform_admin_invitations invitation
        WHERE invitation.email=a.primary_email AND invitation.status='PENDING' AND invitation.expires_at>now()
      )
    )
    UNION ALL
    SELECT lower(i.display_name),i.id,jsonb_build_object(
      'id',i.id,'displayName',i.display_name,'email',i.email::TEXT,
      'status','AWAITING_FIRST_ACCESS','invitationId',i.id,
      'enrollmentRequestId',NULL::UUID,'lastAccessAt',NULL::TIMESTAMPTZ
    ) FROM metas.platform_admin_invitations i WHERE i.status='PENDING' AND i.expires_at>now()
  ) entries;
  RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION metas.create_platform_admin_invitation(
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
  PERFORM pg_advisory_xact_lock(21021);
  PERFORM metas.purge_expired_platform_admins();
  PERFORM pg_advisory_xact_lock(hashtext(normalized_email::TEXT));
  UPDATE metas.platform_admin_invitations SET status='EXPIRED',updated_at=now()
    WHERE email=normalized_email AND status='PENDING' AND expires_at<=now();
  IF EXISTS(
    SELECT 1 FROM metas.platform_admins
    WHERE primary_email=normalized_email AND status IN ('ACTIVE','DISABLED')
  ) THEN
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

CREATE OR REPLACE FUNCTION metas.request_platform_admin_first_enrollment(
  requested_expires_at TIMESTAMPTZ,operation_request_id UUID,
  request_ip_address INET,request_user_agent TEXT
) RETURNS TABLE(
  enrollment_request_id UUID,request_status TEXT,request_expires_at TIMESTAMPTZ,
  approval_expires_at TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE active_request metas.platform_admin_first_enrollment_requests%ROWTYPE;
  current_admin_id UUID; current_session_id UUID; current_session_token_version BIGINT;
  current_session_assurance TEXT; new_request_id UUID; reauthorization_pending BOOLEAN;
BEGIN
  current_admin_id:=metas.require_platform_admin_context();
  current_session_id:=metas.safe_context_uuid('app.current_platform_admin_session_id');
  IF operation_request_id IS NULL OR requested_expires_at<=now()
    OR requested_expires_at>now()+interval '15 minutes'
    OR (request_user_agent IS NOT NULL AND char_length(request_user_agent)>512) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_FIRST_ENROLLMENT_REQUEST';
  END IF;
  SELECT admin.removed_at IS NOT NULL AND admin.purged_at IS NULL
    INTO reauthorization_pending FROM metas.platform_admins admin
    WHERE admin.id=current_admin_id AND admin.status='ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_CONTEXT_REQUIRED';
  END IF;
  SELECT session.token_version,session.assurance_level
    INTO current_session_token_version,current_session_assurance
    FROM metas.platform_admin_sessions session
    WHERE session.id=current_session_id AND session.platform_admin_id=current_admin_id
      AND session.revoked_at IS NULL AND session.expires_at>now() AND session.idle_expires_at>now()
    FOR UPDATE;
  IF NOT FOUND OR current_session_assurance<>'GOOGLE_ONLY' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FIRST_ENROLLMENT_NOT_ALLOWED';
  END IF;
  IF EXISTS(
    SELECT 1 FROM metas.platform_admin_webauthn_credentials credential
    WHERE credential.platform_admin_id=current_admin_id AND credential.revoked_at IS NULL
  ) OR (NOT reauthorization_pending AND EXISTS(
    SELECT 1 FROM metas.platform_admin_webauthn_credentials credential
    WHERE credential.platform_admin_id=current_admin_id
  )) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FIRST_ENROLLMENT_NOT_ALLOWED';
  END IF;

  UPDATE metas.platform_admin_first_enrollment_requests enrollment_request SET status='EXPIRED'
    WHERE enrollment_request.platform_admin_id=current_admin_id
      AND enrollment_request.status='PENDING' AND enrollment_request.expires_at<=now();
  UPDATE metas.platform_admin_first_enrollment_requests enrollment_request SET status='EXPIRED'
    WHERE enrollment_request.platform_admin_id=current_admin_id
      AND enrollment_request.status='APPROVED' AND enrollment_request.approval_expires_at<=now();
  SELECT enrollment_request.* INTO active_request
    FROM metas.platform_admin_first_enrollment_requests enrollment_request
    WHERE enrollment_request.platform_admin_id=current_admin_id
      AND enrollment_request.session_id=current_session_id
      AND enrollment_request.session_token_version=current_session_token_version
      AND enrollment_request.status IN ('PENDING','APPROVED')
    ORDER BY enrollment_request.created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN QUERY SELECT active_request.id,active_request.status,
      active_request.expires_at,active_request.approval_expires_at;
    RETURN;
  END IF;
  WITH revoked_request AS (
    UPDATE metas.platform_admin_first_enrollment_requests enrollment_request
      SET status='REVOKED',revoked_at=now()
      WHERE enrollment_request.platform_admin_id=current_admin_id
        AND enrollment_request.status IN ('PENDING','APPROVED')
      RETURNING enrollment_request.id
  )
  INSERT INTO metas.platform_admin_audit_events(
    platform_admin_id,action,target_type,target_id,request_id,outcome,metadata,ip_address,user_agent
  ) SELECT current_admin_id,'FIRST_ENROLLMENT_REVOKED','FIRST_ENROLLMENT_REQUEST',
      revoked_request.id,operation_request_id,'SUCCESS',
      jsonb_build_object('reason','SUPERSEDED_BY_NEW_SESSION'),request_ip_address,request_user_agent
    FROM revoked_request;
  INSERT INTO metas.platform_admin_first_enrollment_requests(
    platform_admin_id,session_id,session_token_version,expires_at
  ) VALUES(current_admin_id,current_session_id,current_session_token_version,requested_expires_at)
    RETURNING id INTO new_request_id;
  INSERT INTO metas.platform_admin_audit_events(
    platform_admin_id,action,target_type,target_id,request_id,outcome,metadata,ip_address,user_agent
  ) VALUES(current_admin_id,'FIRST_ENROLLMENT_REQUESTED','FIRST_ENROLLMENT_REQUEST',
    new_request_id,operation_request_id,'SUCCESS','{}'::jsonb,request_ip_address,request_user_agent);
  RETURN QUERY SELECT new_request_id,'PENDING'::TEXT,requested_expires_at,NULL::TIMESTAMPTZ;
END $fn$;

CREATE OR REPLACE FUNCTION metas.has_platform_admin_webauthn_credential_history()
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog AS $fn$
DECLARE current_admin_id UUID; reauthorization_pending BOOLEAN;
BEGIN
  current_admin_id:=metas.require_platform_admin_context();
  SELECT admin.removed_at IS NOT NULL AND admin.purged_at IS NULL
    INTO reauthorization_pending FROM metas.platform_admins admin WHERE admin.id=current_admin_id;
  RETURN NOT reauthorization_pending AND EXISTS(
    SELECT 1 FROM metas.platform_admin_webauthn_credentials credential
    WHERE credential.platform_admin_id=current_admin_id
  );
END $fn$;

CREATE FUNCTION metas.clear_platform_admin_removal_after_enrollment()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
  UPDATE metas.platform_admins SET removed_at=NULL,lock_version=lock_version+1
    WHERE id=NEW.platform_admin_id AND status='ACTIVE' AND removed_at IS NOT NULL AND purged_at IS NULL;
  RETURN NEW;
END $fn$;

CREATE TRIGGER platform_admin_credentials_clear_removal
  AFTER INSERT ON metas.platform_admin_webauthn_credentials
  FOR EACH ROW EXECUTE FUNCTION metas.clear_platform_admin_removal_after_enrollment();

CREATE OR REPLACE FUNCTION metas.authenticate_platform_admin_google(
  google_subject TEXT,verified_email public.citext,new_token_hash BYTEA,
  absolute_expires_at TIMESTAMPTZ,inactivity_expires_at TIMESTAMPTZ,
  login_ip_address INET,login_user_agent TEXT,login_request_id UUID
) RETURNS TABLE(platform_admin_id UUID,session_id UUID,display_name TEXT,primary_email TEXT,assurance_level TEXT,expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE authenticated_admin_id UUID; authenticated_display_name TEXT; authenticated_identity_id UUID;
  authenticated_primary_email public.citext; new_session_id UUID; normalized_observed_email public.citext;
  invitation metas.platform_admin_invitations%ROWTYPE; existing_admin metas.platform_admins%ROWTYPE;
  existing_identity metas.platform_admin_identities%ROWTYPE; reauthorized BOOLEAN:=FALSE;
BEGIN
  normalized_observed_email:=lower(btrim(verified_email::TEXT))::public.citext;
  IF google_subject IS NULL OR verified_email IS NULL OR new_token_hash IS NULL
    OR absolute_expires_at IS NULL OR inactivity_expires_at IS NULL OR login_request_id IS NULL
    OR char_length(google_subject) NOT BETWEEN 1 AND 255
    OR char_length(normalized_observed_email::TEXT) NOT BETWEEN 3 AND 320
    OR normalized_observed_email::TEXT !~ '^[^@[:space:]]+@[^@[:space:]]+$'
    OR octet_length(new_token_hash)<>32 OR absolute_expires_at<=now()
    OR inactivity_expires_at<=now() OR inactivity_expires_at>absolute_expires_at
    OR (login_user_agent IS NOT NULL AND char_length(login_user_agent)>512) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_PLATFORM_ADMIN_LOGIN';
  END IF;
  PERFORM pg_advisory_xact_lock(21021);
  PERFORM pg_advisory_xact_lock(hashtext('platform-admin-google:'||google_subject));
  PERFORM pg_advisory_xact_lock(hashtext(normalized_observed_email::TEXT));
  SELECT a.id,a.display_name,a.primary_email,i.id
    INTO authenticated_admin_id,authenticated_display_name,authenticated_primary_email,authenticated_identity_id
    FROM metas.platform_admin_identities i JOIN metas.platform_admins a ON a.id=i.platform_admin_id
    WHERE i.provider='GOOGLE' AND i.provider_subject=google_subject
      AND i.disabled_at IS NULL AND a.status='ACTIVE' FOR UPDATE OF a,i;
  IF NOT FOUND THEN
    SELECT candidate.* INTO invitation FROM metas.platform_admin_invitations candidate
      WHERE candidate.email=normalized_observed_email AND candidate.status='PENDING'
        AND candidate.expires_at>now() FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_ACCESS_DENIED';
    END IF;

    SELECT admin.* INTO existing_admin FROM metas.platform_admins admin
      WHERE admin.primary_email=normalized_observed_email FOR UPDATE;
    IF FOUND THEN
      IF existing_admin.status<>'REMOVED' OR existing_admin.purged_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_ACCESS_DENIED';
      END IF;
      SELECT identity.* INTO existing_identity FROM metas.platform_admin_identities identity
        WHERE identity.platform_admin_id=existing_admin.id AND identity.provider='GOOGLE' FOR UPDATE;
      IF NOT FOUND OR EXISTS(
        SELECT 1 FROM metas.platform_admin_identities other_identity
        WHERE other_identity.provider='GOOGLE' AND other_identity.provider_subject=google_subject
          AND other_identity.id<>existing_identity.id
      ) THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_ACCESS_DENIED';
      END IF;
      UPDATE metas.platform_admins
        SET status='ACTIVE',display_name=invitation.display_name,lock_version=lock_version+1
        WHERE id=existing_admin.id;
      UPDATE metas.platform_admin_identities
        SET provider_subject=google_subject,observed_email=normalized_observed_email,
            provider_verified_at=now(),last_sign_in_at=now(),disabled_at=NULL
        WHERE id=existing_identity.id;
      authenticated_admin_id:=existing_admin.id;
      authenticated_display_name:=invitation.display_name;
      authenticated_primary_email:=normalized_observed_email;
      authenticated_identity_id:=existing_identity.id;
      reauthorized:=TRUE;
    ELSE
      IF EXISTS(
        SELECT 1 FROM metas.platform_admin_identities existing_subject
        WHERE existing_subject.provider='GOOGLE' AND existing_subject.provider_subject=google_subject
      ) THEN
        RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_ACCESS_DENIED';
      END IF;
      INSERT INTO metas.platform_admins AS new_admin(display_name,primary_email)
        VALUES(invitation.display_name,normalized_observed_email)
        RETURNING new_admin.id,new_admin.display_name,new_admin.primary_email
        INTO authenticated_admin_id,authenticated_display_name,authenticated_primary_email;
      INSERT INTO metas.platform_admin_identities(
        platform_admin_id,provider,provider_subject,observed_email,provider_verified_at,last_sign_in_at
      ) VALUES(
        authenticated_admin_id,'GOOGLE',google_subject,normalized_observed_email,now(),now()
      ) RETURNING id INTO authenticated_identity_id;
    END IF;
    UPDATE metas.platform_admin_invitations
      SET status='ACCEPTED',accepted_platform_admin_id=authenticated_admin_id,
          accepted_at=now(),updated_at=now()
      WHERE id=invitation.id;
    INSERT INTO metas.platform_admin_audit_events(
      platform_admin_id,action,target_type,target_id,request_id,outcome,metadata,ip_address,user_agent
    ) VALUES(
      authenticated_admin_id,'PLATFORM_ADMIN_INVITATION_ACCEPTED','PLATFORM_ADMIN_INVITATION',
      invitation.id,login_request_id,'SUCCESS',jsonb_build_object('reauthorized',reauthorized),
      login_ip_address,login_user_agent
    );
  ELSE
    IF normalized_observed_email IS DISTINCT FROM authenticated_primary_email
      AND EXISTS(
        SELECT 1 FROM metas.platform_admin_invitations active_invitation
        WHERE active_invitation.email=normalized_observed_email
          AND active_invitation.status='PENDING' AND active_invitation.expires_at>now()
      ) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PLATFORM_ADMIN_ACCESS_DENIED';
    END IF;
    UPDATE metas.platform_admin_identities
      SET observed_email=normalized_observed_email,last_sign_in_at=now()
      WHERE id=authenticated_identity_id;
  END IF;
  INSERT INTO metas.platform_admin_sessions(
    platform_admin_id,identity_id,token_hash,assurance_level,expires_at,idle_expires_at,ip_address,user_agent
  ) VALUES(
    authenticated_admin_id,authenticated_identity_id,new_token_hash,'GOOGLE_ONLY',
    absolute_expires_at,inactivity_expires_at,login_ip_address,login_user_agent
  ) RETURNING id INTO new_session_id;
  INSERT INTO metas.platform_admin_audit_events(
    platform_admin_id,action,target_type,target_id,request_id,outcome,metadata,ip_address,user_agent
  ) VALUES(
    authenticated_admin_id,'PLATFORM_ADMIN_LOGIN','PLATFORM_ADMIN_SESSION',new_session_id,
    login_request_id,'SUCCESS',jsonb_build_object('assuranceLevel','GOOGLE_ONLY'),
    login_ip_address,login_user_agent
  );
  RETURN QUERY SELECT authenticated_admin_id,new_session_id,authenticated_display_name,
    authenticated_primary_email::TEXT,'GOOGLE_ONLY'::TEXT,absolute_expires_at;
END $fn$;

REVOKE ALL ON FUNCTION metas.purge_expired_platform_admins()
  FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_runtime,metas_platform_admin_operator;
REVOKE ALL ON FUNCTION metas.remove_platform_admin_access(UUID,TIMESTAMPTZ,UUID)
  FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_runtime,metas_platform_admin_operator;
REVOKE ALL ON FUNCTION metas.clear_platform_admin_removal_after_enrollment()
  FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_runtime,metas_platform_admin_operator;
REVOKE ALL ON FUNCTION metas.read_platform_admin_access()
  FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_operator;
REVOKE ALL ON FUNCTION metas.create_platform_admin_invitation(TEXT,public.citext,TIMESTAMPTZ,TIMESTAMPTZ,UUID)
  FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_operator;
REVOKE ALL ON FUNCTION metas.authenticate_platform_admin_google(TEXT,public.citext,BYTEA,TIMESTAMPTZ,TIMESTAMPTZ,INET,TEXT,UUID)
  FROM PUBLIC,metas_app_runtime,metas_migration_runner,metas_platform_admin_operator;
REVOKE ALL ON FUNCTION metas.request_platform_admin_first_enrollment(TIMESTAMPTZ,UUID,INET,TEXT)
  FROM PUBLIC,metas_migration_runner,metas_platform_admin_operator;
REVOKE ALL ON FUNCTION metas.has_platform_admin_webauthn_credential_history()
  FROM PUBLIC,metas_migration_runner,metas_platform_admin_operator;

GRANT EXECUTE ON FUNCTION metas.remove_platform_admin_access(UUID,TIMESTAMPTZ,UUID)
  TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.read_platform_admin_access() TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.create_platform_admin_invitation(TEXT,public.citext,TIMESTAMPTZ,TIMESTAMPTZ,UUID)
  TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.authenticate_platform_admin_google(TEXT,public.citext,BYTEA,TIMESTAMPTZ,TIMESTAMPTZ,INET,TEXT,UUID)
  TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.request_platform_admin_first_enrollment(TIMESTAMPTZ,UUID,INET,TEXT)
  TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.has_platform_admin_webauthn_credential_history()
  TO metas_platform_admin_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
