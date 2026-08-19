import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
CREATE OR REPLACE FUNCTION metas.manager_save_goal_configuration(
  target_monthly_target_cents BIGINT,
  target_sold_amount_cents BIGINT,
  target_remaining_business_days INTEGER,
  target_total_business_days INTEGER,
  target_role_weights JSONB,
  expected_lock_version INTEGER
)
RETURNS TABLE (
  goal_id UUID,
  goal_month TEXT,
  monthly_target_cents TEXT,
  sold_amount_cents TEXT,
  remaining_business_days INTEGER,
  total_business_days INTEGER,
  lock_version INTEGER,
  role TEXT,
  employee_count_snapshot INTEGER,
  weight TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_goal_id UUID;
  current_lock_version INTEGER;
  manager_store_id UUID;
  manager_user_id UUID;
  new_goal_id UUID;
  new_lock_version INTEGER;
  role_count INTEGER;
  store_timezone TEXT;
  target_period_start DATE;
  version_timestamp TIMESTAMPTZ;
BEGIN
  manager_store_id := metas.require_manager_store();
  manager_user_id := metas.safe_context_uuid('app.current_user_id');

  IF target_monthly_target_cents IS NULL OR target_monthly_target_cents <= 0
    OR target_monthly_target_cents > 9007199254740991
    OR target_sold_amount_cents IS NULL OR target_sold_amount_cents < 0
    OR target_sold_amount_cents > 9007199254740991
    OR target_total_business_days IS NULL
    OR target_total_business_days NOT BETWEEN 1 AND 31
    OR target_remaining_business_days IS NULL
    OR target_remaining_business_days NOT BETWEEN 0 AND target_total_business_days
    OR target_role_weights IS NULL
    OR jsonb_typeof(target_role_weights) <> 'array'
    OR jsonb_array_length(target_role_weights) <> 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GOAL_CONFIGURATION';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(target_role_weights) item
    WHERE jsonb_typeof(item) <> 'object'
      OR NOT (item ? 'role')
      OR NOT (item ? 'weight')
      OR jsonb_typeof(item->'role') <> 'string'
      OR jsonb_typeof(item->'weight') <> 'string'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GOAL_CONFIGURATION';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(target_role_weights) item
    WHERE item->>'role' NOT IN ('BALCONISTA', 'CAIXA', 'FARMACEUTICO')
      OR item->>'weight' !~ '^(0|[1-9][0-9]{0,2})([.][0-9]{1,4})?$'
      OR (item->>'weight')::NUMERIC > 100
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GOAL_CONFIGURATION';
  END IF;

  SELECT count(DISTINCT item->>'role')::INTEGER
  INTO role_count
  FROM jsonb_array_elements(target_role_weights) item;
  IF role_count <> 3 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_GOAL_CONFIGURATION';
  END IF;

  SELECT store.timezone
  INTO store_timezone
  FROM metas.stores store
  WHERE store.id = manager_store_id
  FOR UPDATE;

  target_period_start := date_trunc(
    'month',
    timezone(store_timezone, CURRENT_TIMESTAMP)::DATE
  )::DATE;

  SELECT goal.id, goal.lock_version
  INTO current_goal_id, current_lock_version
  FROM metas.goals goal
  WHERE goal.store_id = manager_store_id
    AND goal.period_start = target_period_start
    AND goal.valid_until IS NULL
  FOR UPDATE;

  IF (current_goal_id IS NULL AND expected_lock_version IS NOT NULL)
    OR (current_goal_id IS NOT NULL AND expected_lock_version IS DISTINCT FROM current_lock_version) THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'GOAL_CONFIGURATION_CONFLICT';
  END IF;

  version_timestamp := clock_timestamp();
  new_lock_version := COALESCE(current_lock_version + 1, 1);

  IF current_goal_id IS NOT NULL THEN
    UPDATE metas.goals
    SET valid_until = version_timestamp,
        lock_version = current_lock_version + 1
    WHERE metas.goals.id = current_goal_id;
  END IF;

  INSERT INTO metas.goals (
    store_id,
    period_start,
    period_end,
    monthly_target_cents,
    sold_baseline_cents,
    remaining_business_days_snapshot,
    total_business_days_snapshot,
    valid_from,
    created_by_user_id,
    lock_version
  ) VALUES (
    manager_store_id,
    target_period_start,
    (target_period_start + INTERVAL '1 month')::DATE,
    target_monthly_target_cents,
    target_sold_amount_cents,
    target_remaining_business_days,
    target_total_business_days,
    version_timestamp,
    manager_user_id,
    new_lock_version
  ) RETURNING metas.goals.id INTO new_goal_id;

  INSERT INTO metas.goal_roles (goal_id, store_id, role, weight, employee_count_snapshot)
  SELECT
    new_goal_id,
    manager_store_id,
    (item->>'role')::metas.employee_role,
    (item->>'weight')::NUMERIC,
    (
      SELECT count(*)::INTEGER
      FROM metas.employees employee
      WHERE employee.store_id = manager_store_id
        AND employee.status = 'ATIVO'
        AND employee.role = (item->>'role')::metas.employee_role
    )
  FROM jsonb_array_elements(target_role_weights) item;

  RETURN QUERY SELECT * FROM metas.manager_get_goal_configuration();
END
$function$;

REVOKE EXECUTE ON FUNCTION metas.manager_save_goal_configuration(
  BIGINT, BIGINT, INTEGER, INTEGER, JSONB, INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION metas.manager_save_goal_configuration(
  BIGINT, BIGINT, INTEGER, INTEGER, JSONB, INTEGER
) TO metas_app_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
