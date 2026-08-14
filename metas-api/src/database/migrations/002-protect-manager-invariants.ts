import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
CREATE FUNCTION metas.enforce_employee_manager_invariants()
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

    IF NEW.creation_source = 'BOOTSTRAP' THEN
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
    IF NEW.store_id <> OLD.store_id OR NEW.user_id <> OLD.user_id OR NEW.creation_source <> OLD.creation_source THEN
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

CREATE TRIGGER employees_manager_invariants
BEFORE INSERT OR UPDATE OR DELETE ON metas.employees
FOR EACH ROW EXECUTE FUNCTION metas.enforce_employee_manager_invariants();

CREATE FUNCTION metas.bootstrap_first_manager(
  target_store_id UUID,
  target_user_id UUID,
  target_joined_on DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, metas
AS $function$
DECLARE
  employee_id UUID;
BEGIN
  PERFORM 1 FROM metas.stores WHERE id = target_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'BOOTSTRAP_STORE_NOT_FOUND';
  END IF;

  IF EXISTS (SELECT 1 FROM metas.employees WHERE store_id = target_store_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'STORE_ALREADY_BOOTSTRAPPED';
  END IF;

  INSERT INTO metas.employees (
    store_id,
    user_id,
    role,
    status,
    joined_on,
    created_by_user_id,
    creation_source
  ) VALUES (
    target_store_id,
    target_user_id,
    'GESTOR',
    'ATIVO',
    target_joined_on,
    NULL,
    'BOOTSTRAP'
  )
  RETURNING id INTO employee_id;

  RETURN employee_id;
END
$function$;

REVOKE EXECUTE ON FUNCTION metas.enforce_employee_manager_invariants() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.bootstrap_first_manager(UUID, UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION metas.bootstrap_first_manager(UUID, UUID, DATE)
  TO metas_migration_runner;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
