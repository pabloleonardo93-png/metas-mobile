import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
CREATE TABLE metas.goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  monthly_target_cents BIGINT NOT NULL,
  sold_baseline_cents BIGINT NOT NULL DEFAULT 0,
  remaining_business_days_snapshot SMALLINT NOT NULL,
  total_business_days_snapshot SMALLINT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ NULL,
  created_by_user_id UUID NOT NULL,
  lock_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT goals_store_fk FOREIGN KEY (store_id)
    REFERENCES metas.stores (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT goals_created_by_user_fk FOREIGN KEY (created_by_user_id)
    REFERENCES metas.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT goals_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT goals_monthly_target_positive CHECK (monthly_target_cents > 0),
  CONSTRAINT goals_sold_baseline_nonnegative CHECK (sold_baseline_cents >= 0),
  CONSTRAINT goals_money_safe_range CHECK (
    monthly_target_cents <= 9007199254740991
    AND sold_baseline_cents <= 9007199254740991
  ),
  CONSTRAINT goals_business_days_valid CHECK (
    total_business_days_snapshot BETWEEN 1 AND 31
    AND remaining_business_days_snapshot BETWEEN 0 AND total_business_days_snapshot
  ),
  CONSTRAINT goals_monthly_period_valid CHECK (
    period_start = date_trunc('month', period_start)::DATE
    AND period_end = (period_start + INTERVAL '1 month')::DATE
  ),
  CONSTRAINT goals_version_interval_valid CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT goals_version_period_no_overlap EXCLUDE USING gist (
    store_id WITH =,
    period_start WITH =,
    tstzrange(valid_from, valid_until, '[)') WITH &&
  ),
  CONSTRAINT goals_lock_version_positive CHECK (lock_version > 0)
);

CREATE TABLE metas.goal_roles (
  goal_id UUID NOT NULL,
  store_id UUID NOT NULL,
  role metas.employee_role NOT NULL,
  weight NUMERIC(8, 4) NOT NULL,
  employee_count_snapshot INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT goal_roles_pk PRIMARY KEY (goal_id, role),
  CONSTRAINT goal_roles_goal_store_fk FOREIGN KEY (goal_id, store_id)
    REFERENCES metas.goals (id, store_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT goal_roles_employee_role_only CHECK (role <> 'GESTOR'),
  CONSTRAINT goal_roles_weight_valid CHECK (weight BETWEEN 0 AND 100),
  CONSTRAINT goal_roles_employee_count_nonnegative CHECK (employee_count_snapshot >= 0)
);

CREATE UNIQUE INDEX goals_current_store_period_unique
  ON metas.goals (store_id, period_start)
  WHERE valid_until IS NULL;
CREATE INDEX goals_store_period_history_idx
  ON metas.goals (store_id, period_start, valid_from DESC);
CREATE INDEX goal_roles_store_role_idx ON metas.goal_roles (store_id, role);

CREATE TRIGGER goals_set_updated_at
BEFORE UPDATE ON metas.goals
FOR EACH ROW EXECUTE FUNCTION metas.set_updated_at();

ALTER TABLE metas.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.goals FORCE ROW LEVEL SECURITY;
ALTER TABLE metas.goal_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.goal_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY goals_owner_all ON metas.goals
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY goal_roles_owner_all ON metas.goal_roles
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY goals_runtime_select ON metas.goals
  FOR SELECT TO metas_app_runtime
  USING (
    metas.has_active_database_context()
    AND store_id = metas.safe_context_uuid('app.current_store_id')
  );
CREATE POLICY goal_roles_runtime_select ON metas.goal_roles
  FOR SELECT TO metas_app_runtime
  USING (
    metas.has_active_database_context()
    AND store_id = metas.safe_context_uuid('app.current_store_id')
  );

REVOKE ALL ON TABLE metas.goals FROM PUBLIC;
REVOKE ALL ON TABLE metas.goal_roles FROM PUBLIC;
GRANT SELECT ON TABLE metas.goals TO metas_app_runtime;
GRANT SELECT ON TABLE metas.goal_roles TO metas_app_runtime;

CREATE FUNCTION metas.manager_get_goal_configuration()
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
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  manager_store_id UUID;
  store_timezone TEXT;
  target_period_start DATE;
BEGIN
  manager_store_id := metas.require_manager_store();

  SELECT store.timezone
  INTO store_timezone
  FROM metas.stores store
  WHERE store.id = manager_store_id;

  target_period_start := date_trunc(
    'month',
    timezone(store_timezone, CURRENT_TIMESTAMP)::DATE
  )::DATE;

  RETURN QUERY
  WITH role_defaults(role_value, default_weight) AS (
    VALUES
      ('BALCONISTA'::metas.employee_role, 1.0000::NUMERIC),
      ('FARMACEUTICO'::metas.employee_role, 0.7000::NUMERIC),
      ('CAIXA'::metas.employee_role, 0.3000::NUMERIC)
  ), employee_counts AS (
    SELECT employee.role, count(*)::INTEGER AS employee_count
    FROM metas.employees employee
    WHERE employee.store_id = manager_store_id
      AND employee.status = 'ATIVO'
      AND employee.role <> 'GESTOR'
    GROUP BY employee.role
  )
  SELECT
    goal.id,
    to_char(target_period_start, 'YYYY-MM'),
    COALESCE(goal.monthly_target_cents, 0)::TEXT,
    COALESCE(goal.sold_baseline_cents, 0)::TEXT,
    COALESCE(goal.remaining_business_days_snapshot, 0)::INTEGER,
    COALESCE(goal.total_business_days_snapshot, 0)::INTEGER,
    goal.lock_version,
    role_defaults.role_value::TEXT,
    COALESCE(goal_role.employee_count_snapshot, employee_counts.employee_count, 0),
    COALESCE(goal_role.weight, role_defaults.default_weight)::TEXT
  FROM role_defaults
  LEFT JOIN metas.goals goal
    ON goal.store_id = manager_store_id
   AND goal.period_start = target_period_start
   AND goal.valid_until IS NULL
  LEFT JOIN metas.goal_roles goal_role
    ON goal_role.goal_id = goal.id
   AND goal_role.store_id = manager_store_id
   AND goal_role.role = role_defaults.role_value
  LEFT JOIN employee_counts ON employee_counts.role = role_defaults.role_value
  ORDER BY CASE role_defaults.role_value
    WHEN 'BALCONISTA'::metas.employee_role THEN 1
    WHEN 'FARMACEUTICO'::metas.employee_role THEN 2
    ELSE 3
  END;
END
$function$;

CREATE FUNCTION metas.manager_save_goal_configuration(
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
        lock_version = lock_version + 1
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

REVOKE EXECUTE ON FUNCTION metas.manager_get_goal_configuration() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.manager_save_goal_configuration(
  BIGINT, BIGINT, INTEGER, INTEGER, JSONB, INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION metas.manager_get_goal_configuration() TO metas_app_runtime;
GRANT EXECUTE ON FUNCTION metas.manager_save_goal_configuration(
  BIGINT, BIGINT, INTEGER, INTEGER, JSONB, INTEGER
) TO metas_app_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
