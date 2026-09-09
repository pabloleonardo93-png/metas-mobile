import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
ALTER TABLE metas.stores ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0);
ALTER TABLE metas.employees ADD COLUMN created_by_platform_admin_id UUID NULL
  REFERENCES metas.platform_admins(id) ON DELETE RESTRICT;
ALTER TABLE metas.employees DROP CONSTRAINT employees_creation_source_valid;
ALTER TABLE metas.employees ADD CONSTRAINT employees_creation_source_valid
  CHECK (creation_source IN ('BOOTSTRAP', 'MANAGER', 'IMPORT', 'PLATFORM_ADMIN'));
ALTER TABLE metas.employees DROP CONSTRAINT employees_creation_actor_valid;
ALTER TABLE metas.employees ADD CONSTRAINT employees_creation_actor_valid CHECK (
  (creation_source = 'BOOTSTRAP' AND created_by_user_id IS NULL AND created_by_platform_admin_id IS NULL)
  OR (creation_source IN ('MANAGER', 'IMPORT') AND created_by_user_id IS NOT NULL AND created_by_platform_admin_id IS NULL)
  OR (creation_source = 'PLATFORM_ADMIN' AND created_by_user_id IS NULL AND created_by_platform_admin_id IS NOT NULL)
);

CREATE FUNCTION metas.require_platform_management_context()
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE admin_id UUID;
BEGIN
  IF session_user <> 'metas_platform_admin_runtime' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANAGEMENT_FORBIDDEN';
  END IF;
  admin_id := metas.require_platform_admin_context();
  IF NOT EXISTS (
    SELECT 1 FROM metas.platform_admin_sessions
    WHERE id = metas.safe_context_uuid('app.current_platform_admin_session_id')
      AND platform_admin_id = admin_id AND assurance_level = 'MFA_VERIFIED'
      AND mfa_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANAGEMENT_MFA_REQUIRED';
  END IF;
  RETURN admin_id;
END $fn$;
REVOKE ALL ON FUNCTION metas.require_platform_management_context() FROM PUBLIC;
CREATE OR REPLACE FUNCTION metas.enforce_employee_manager_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, metas
AS $function$
DECLARE
  target_store_id UUID;
  store_has_employees BOOLEAN;
  other_active_managers BIGINT;
BEGIN
  target_store_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.store_id ELSE NEW.store_id END;

  PERFORM 1 FROM metas.stores WHERE id = target_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'EMPLOYEE_STORE_NOT_FOUND';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM metas.employees WHERE store_id = NEW.store_id
    ) INTO store_has_employees;

    IF NEW.creation_source = 'PLATFORM_ADMIN' THEN
      IF NEW.created_by_platform_admin_id IS DISTINCT FROM metas.require_platform_management_context()
        OR NEW.created_by_user_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANAGEMENT_FORBIDDEN';
      END IF;
      IF NOT store_has_employees AND (NEW.role <> 'GESTOR' OR NEW.status <> 'ATIVO') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FIRST_EMPLOYEE_MUST_BE_BOOTSTRAP_MANAGER';
      END IF;
    ELSIF NEW.creation_source = 'BOOTSTRAP' THEN
      IF store_has_employees THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'STORE_ALREADY_BOOTSTRAPPED';
      END IF;
      IF NEW.role <> 'GESTOR' OR NEW.status <> 'ATIVO' OR NEW.created_by_user_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_BOOTSTRAP_MANAGER';
      END IF;
    ELSE
      IF NOT store_has_employees THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FIRST_EMPLOYEE_MUST_BE_BOOTSTRAP_MANAGER';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM metas.employees creator
        WHERE creator.store_id = NEW.store_id
          AND creator.user_id = NEW.created_by_user_id
          AND creator.role = 'GESTOR'
          AND creator.status = 'ATIVO'
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CREATOR_MUST_BE_ACTIVE_MANAGER';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.store_id <> OLD.store_id OR NEW.user_id <> OLD.user_id OR NEW.creation_source <> OLD.creation_source
      OR NEW.created_by_platform_admin_id IS DISTINCT FROM OLD.created_by_platform_admin_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'EMPLOYEE_IDENTITY_FIELDS_IMMUTABLE';
    END IF;

    IF OLD.role = 'GESTOR' AND OLD.status = 'ATIVO'
      AND (NEW.role <> 'GESTOR' OR NEW.status <> 'ATIVO') THEN
      SELECT count(*)
      INTO other_active_managers
      FROM metas.employees manager
      WHERE manager.store_id = OLD.store_id
        AND manager.id <> OLD.id
        AND manager.role = 'GESTOR'
        AND manager.status = 'ATIVO';

      IF other_active_managers = 0 THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LAST_ACTIVE_MANAGER_REQUIRED';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF OLD.role = 'GESTOR' AND OLD.status = 'ATIVO' THEN
    SELECT count(*)
    INTO other_active_managers
    FROM metas.employees manager
    WHERE manager.store_id = OLD.store_id
      AND manager.id <> OLD.id
      AND manager.role = 'GESTOR'
      AND manager.status = 'ATIVO';

    IF other_active_managers = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LAST_ACTIVE_MANAGER_REQUIRED';
    END IF;
  END IF;

  RETURN OLD;
END
$function$;


CREATE FUNCTION metas.read_platform_directory(resource TEXT, filters JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE rows JSONB; total_count BIGINT; page_number INTEGER; page_size INTEGER;
  search TEXT; filter_status TEXT; filter_role TEXT; filter_store UUID;
BEGIN
  PERFORM metas.require_platform_management_context();
  IF resource IS NULL OR jsonb_typeof(filters) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MANAGEMENT_INVALID_INPUT';
  END IF;
  page_number := COALESCE((filters->>'page')::INTEGER, 1);
  page_size := COALESCE((filters->>'pageSize')::INTEGER, 20);
  search := COALESCE(filters->>'q', '');
  filter_status := COALESCE(filters->>'status', 'ALL');
  filter_role := COALESCE(filters->>'role', 'ALL');
  filter_store := (filters->>'storeId')::UUID;
  IF resource NOT IN ('pharmacies', 'employees', 'audit') OR page_number NOT BETWEEN 1 AND 100000
    OR page_size NOT BETWEEN 1 AND 50 OR length(search) > 100
    OR filter_status NOT IN ('ALL', 'ACTIVE', 'INACTIVE')
    OR filter_role NOT IN ('ALL', 'GESTOR', 'BALCONISTA', 'CAIXA', 'FARMACEUTICO') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MANAGEMENT_INVALID_INPUT';
  END IF;
  IF resource = 'pharmacies' THEN
    WITH filtered AS (
      SELECT s.* FROM metas.stores s
      WHERE (search = '' OR strpos(lower(s.name), lower(search)) > 0 OR strpos(lower(s.slug::TEXT), lower(search)) > 0)
        AND (filter_status = 'ALL' OR s.is_active = (filter_status = 'ACTIVE'))
    ), page_rows AS (
      SELECT * FROM filtered ORDER BY lower(name), id LIMIT page_size OFFSET (page_number-1)*page_size
    )
    SELECT (SELECT count(*) FROM filtered), COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'slug', s.slug, 'timezone', s.timezone,
      'isActive', s.is_active, 'version', s.lock_version, 'updatedAt', s.updated_at,
      'employeeCount', (SELECT count(*) FROM metas.employees e WHERE e.store_id=s.id AND e.status='ATIVO'),
      'managers', (SELECT COALESCE(jsonb_agg(u.full_name ORDER BY u.full_name), '[]'::JSONB)
        FROM metas.employees e JOIN metas.users u ON u.id=e.user_id
        WHERE e.store_id=s.id AND e.status='ATIVO' AND e.role='GESTOR')
    ) ORDER BY lower(s.name), s.id), '[]'::JSONB) INTO total_count, rows FROM page_rows s;
  ELSIF resource = 'employees' THEN
    WITH filtered AS (
      SELECT e.*, u.full_name, u.primary_email, u.account_status, u.lock_version AS user_version, s.name AS store_name
      FROM metas.employees e JOIN metas.users u ON u.id=e.user_id JOIN metas.stores s ON s.id=e.store_id
      WHERE (search = '' OR strpos(lower(u.full_name), lower(search)) > 0 OR strpos(lower(u.primary_email::TEXT), lower(search)) > 0)
        AND (filter_status='ALL' OR e.status=CASE WHEN filter_status='ACTIVE' THEN 'ATIVO' ELSE 'INATIVO' END)
        AND (filter_role='ALL' OR e.role::TEXT=filter_role)
        AND (filter_store IS NULL OR e.store_id=filter_store)
    ), page_rows AS (
      SELECT * FROM filtered ORDER BY lower(full_name), id LIMIT page_size OFFSET (page_number-1)*page_size
    )
    SELECT (SELECT count(*) FROM filtered), COALESCE(jsonb_agg(jsonb_build_object(
      'id', e.id, 'userId', e.user_id, 'storeId', e.store_id, 'storeName', e.store_name,
      'name', e.full_name, 'email', e.primary_email, 'role', e.role, 'status', e.status,
      'accountStatus', e.account_status, 'joinedOn', e.joined_on, 'endedOn', e.ended_on,
      'version', e.lock_version, 'userVersion', e.user_version, 'updatedAt', e.updated_at
    ) ORDER BY lower(e.full_name), e.id), '[]'::JSONB) INTO total_count, rows FROM page_rows e;
  ELSE
    WITH filtered AS (
      SELECT a.*, p.display_name AS actor FROM metas.platform_admin_audit_events a
      JOIN metas.platform_admins p ON p.id=a.platform_admin_id
      WHERE a.target_type IN ('store', 'employee')
        AND (search='' OR strpos(lower(a.action), lower(search)) > 0 OR strpos(lower(p.display_name), lower(search)) > 0)
    ), page_rows AS (
      SELECT * FROM filtered ORDER BY created_at DESC, id DESC LIMIT page_size OFFSET (page_number-1)*page_size
    )
    SELECT (SELECT count(*) FROM filtered), COALESCE(jsonb_agg(jsonb_build_object(
      'id', a.id, 'action', a.action, 'actor', a.actor, 'targetType', a.target_type,
      'targetId', a.target_id, 'outcome', a.outcome, 'createdAt', a.created_at
    ) ORDER BY a.created_at DESC, a.id DESC), '[]'::JSONB) INTO total_count, rows FROM page_rows a;
  END IF;
  RETURN jsonb_build_object('items', rows, 'total', total_count, 'page', page_number, 'pageSize', page_size);
END $fn$;

CREATE FUNCTION metas.write_platform_directory(operation TEXT, target_id UUID, input JSONB, operation_request_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE admin_id UUID; target_store UUID; affected_id UUID; event_action TEXT;
  event_target TEXT; previous_employee metas.employees%ROWTYPE; previous_store metas.stores%ROWTYPE;
  previous_user metas.users%ROWTYPE; selected_role metas.employee_role; selected_status TEXT;
BEGIN
  admin_id := metas.require_platform_management_context();
  IF operation_request_id IS NULL OR operation IS NULL
    OR jsonb_typeof(input) IS DISTINCT FROM 'object'
    OR operation NOT IN ('savePharmacy', 'updateEmployee', 'linkEmployee') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='MANAGEMENT_INVALID_INPUT';
  END IF;
  IF operation='savePharmacy' THEN
    IF input->>'name' IS NULL OR length(btrim(input->>'name')) NOT BETWEEN 2 AND 150
      OR input->>'slug' IS NULL OR length(input->>'slug') NOT BETWEEN 2 AND 80
      OR (input->>'slug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name=input->>'timezone')
      OR jsonb_typeof(input->'isActive') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='MANAGEMENT_INVALID_INPUT';
    END IF;
    IF target_id IS NULL THEN
      INSERT INTO metas.stores(name,slug,timezone,is_active)
      VALUES (btrim(input->>'name'),(input->>'slug')::public.citext,input->>'timezone',(input->>'isActive')::BOOLEAN)
      RETURNING id INTO affected_id;
      event_action := 'STORE_CREATED';
    ELSE
      SELECT * INTO previous_store FROM metas.stores WHERE id=target_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='MANAGEMENT_NOT_FOUND'; END IF;
      IF previous_store.lock_version IS DISTINCT FROM (input->>'version')::INTEGER THEN
        RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='MANAGEMENT_VERSION_CONFLICT';
      END IF;
      UPDATE metas.stores SET name=btrim(input->>'name'), slug=(input->>'slug')::public.citext,
        timezone=input->>'timezone', is_active=(input->>'isActive')::BOOLEAN, lock_version=lock_version+1 WHERE id=target_id;
      IF NOT (input->>'isActive')::BOOLEAN THEN
        UPDATE metas.sessions SET revoked_at=COALESCE(revoked_at,now())
        WHERE employee_id IN (SELECT id FROM metas.employees WHERE store_id=target_id) AND revoked_at IS NULL;
      END IF;
      affected_id := target_id;
      event_action := CASE WHEN previous_store.is_active IS DISTINCT FROM (input->>'isActive')::BOOLEAN
        THEN CASE WHEN (input->>'isActive')::BOOLEAN THEN 'STORE_ACTIVATED' ELSE 'STORE_DEACTIVATED' END ELSE 'STORE_UPDATED' END;
    END IF;
    target_store := affected_id; event_target := 'store';
  ELSE
    IF target_id IS NULL OR input->>'role' IS NULL OR input->>'role' NOT IN ('GESTOR','BALCONISTA','CAIXA','FARMACEUTICO') THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='MANAGEMENT_INVALID_INPUT';
    END IF;
    selected_role := (input->>'role')::metas.employee_role;
    SELECT store_id INTO target_store FROM metas.employees WHERE id=target_id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='MANAGEMENT_NOT_FOUND'; END IF;
    PERFORM 1 FROM metas.stores WHERE id IN (target_store, (input->>'storeId')::UUID) ORDER BY id FOR UPDATE;
    SELECT * INTO previous_employee FROM metas.employees WHERE id=target_id FOR UPDATE;
    SELECT * INTO previous_user FROM metas.users WHERE id=previous_employee.user_id FOR UPDATE;
    IF operation='updateEmployee' THEN
      selected_status := input->>'status';
      IF selected_status IS NULL OR selected_status NOT IN ('ATIVO','INATIVO')
        OR input->>'name' IS NULL OR length(btrim(input->>'name')) NOT BETWEEN 2 AND 150 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='MANAGEMENT_INVALID_INPUT';
      END IF;
      IF previous_employee.lock_version IS DISTINCT FROM (input->>'version')::INTEGER
        OR previous_user.lock_version IS DISTINCT FROM (input->>'userVersion')::INTEGER THEN
        RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='MANAGEMENT_VERSION_CONFLICT';
      END IF;
      UPDATE metas.users SET full_name=btrim(input->>'name'), lock_version=lock_version+1 WHERE id=previous_user.id;
      UPDATE metas.employees SET role=selected_role, status=selected_status,
        ended_on=CASE WHEN selected_status='INATIVO' THEN GREATEST(joined_on,CURRENT_DATE) ELSE NULL END,
        lock_version=lock_version+1 WHERE id=target_id;
      IF previous_employee.role<>selected_role OR previous_employee.status<>selected_status THEN
        UPDATE metas.sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE employee_id=target_id AND revoked_at IS NULL;
      END IF;
      affected_id := target_id;
      event_action := CASE WHEN previous_employee.role<>selected_role THEN 'EMPLOYEE_ROLE_CHANGED'
        WHEN previous_employee.status<>selected_status THEN CASE WHEN selected_status='ATIVO'
        THEN 'EMPLOYEE_ACTIVATED' ELSE 'EMPLOYEE_DEACTIVATED' END ELSE 'EMPLOYEE_UPDATED' END;
    ELSE
      target_store := (input->>'storeId')::UUID;
      IF target_store IS NULL OR NOT EXISTS (SELECT 1 FROM metas.stores WHERE id=target_store AND is_active) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='MANAGEMENT_STORE_INACTIVE';
      END IF;
      IF EXISTS (SELECT 1 FROM metas.employees WHERE store_id=target_store AND user_id=previous_employee.user_id) THEN
        RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='MANAGEMENT_LINK_EXISTS';
      END IF;
      INSERT INTO metas.employees(store_id,user_id,role,status,joined_on,creation_source,created_by_platform_admin_id)
      VALUES (target_store,previous_employee.user_id,selected_role,'ATIVO',CURRENT_DATE,'PLATFORM_ADMIN',admin_id)
      RETURNING id INTO affected_id;
      event_action := 'EMPLOYEE_LINKED';
    END IF;
    event_target := 'employee';
  END IF;
  INSERT INTO metas.platform_admin_audit_events(platform_admin_id,action,target_type,target_id,store_id,request_id,outcome,metadata)
  VALUES(admin_id,event_action,event_target,affected_id,target_store,operation_request_id,'SUCCESS',
    CASE WHEN operation='updateEmployee' THEN jsonb_build_object(
      'previousRole',previous_employee.role,'role',selected_role,
      'previousStatus',previous_employee.status,'status',selected_status,
      'nameChanged',previous_user.full_name IS DISTINCT FROM btrim(input->>'name')) ELSE '{}'::JSONB END);
  RETURN affected_id;
END $fn$;
REVOKE ALL ON FUNCTION metas.read_platform_directory(TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION metas.write_platform_directory(TEXT,UUID,JSONB,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION metas.read_platform_directory(TEXT,JSONB) TO metas_platform_admin_runtime;
GRANT EXECUTE ON FUNCTION metas.write_platform_directory(TEXT,UUID,JSONB,UUID) TO metas_platform_admin_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
