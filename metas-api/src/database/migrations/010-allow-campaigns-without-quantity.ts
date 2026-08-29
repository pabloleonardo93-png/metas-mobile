import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
ALTER TABLE metas.campaigns
  ALTER COLUMN target_quantity DROP NOT NULL,
  DROP CONSTRAINT campaigns_target_quantity_valid,
  ADD CONSTRAINT campaigns_target_quantity_valid CHECK (
    target_quantity IS NULL OR target_quantity BETWEEN 1 AND 1000000000
  );

CREATE OR REPLACE FUNCTION metas.manager_create_campaign(
  campaign_name TEXT,
  campaign_target_quantity INTEGER,
  campaign_target_amount_cents BIGINT,
  campaign_start_date DATE,
  campaign_end_date DATE
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  target_quantity INTEGER,
  sold_quantity INTEGER,
  target_amount_cents TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT,
  lock_version INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  manager_store_id UUID;
  manager_user_id UUID;
  new_campaign_id UUID;
  normalized_name TEXT;
BEGIN
  manager_store_id := metas.require_manager_store();
  manager_user_id := metas.safe_context_uuid('app.current_user_id');
  normalized_name := btrim(campaign_name);

  IF normalized_name IS NULL OR char_length(normalized_name) NOT BETWEEN 2 AND 120
    OR (
      campaign_target_quantity IS NOT NULL
      AND campaign_target_quantity NOT BETWEEN 1 AND 1000000000
    )
    OR campaign_target_amount_cents IS NULL
    OR campaign_target_amount_cents NOT BETWEEN 1 AND 9007199254740991
    OR campaign_start_date IS NULL
    OR campaign_end_date IS NULL
    OR campaign_end_date < campaign_start_date THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_CAMPAIGN';
  END IF;

  INSERT INTO metas.campaigns (
    store_id,
    name,
    target_quantity,
    target_amount_cents,
    start_date,
    end_date,
    created_by_user_id
  ) VALUES (
    manager_store_id,
    normalized_name,
    campaign_target_quantity,
    campaign_target_amount_cents,
    campaign_start_date,
    campaign_end_date,
    manager_user_id
  )
  RETURNING metas.campaigns.id INTO new_campaign_id;

  RETURN QUERY
  SELECT
    campaign.id,
    campaign.name,
    campaign.target_quantity,
    campaign.sold_quantity,
    campaign.target_amount_cents::TEXT,
    campaign.start_date,
    campaign.end_date,
    CASE
      WHEN campaign.closed_at IS NOT NULL
        OR campaign.end_date < timezone(store.timezone, CURRENT_TIMESTAMP)::DATE
        THEN 'ENCERRADA'
      WHEN campaign.start_date > timezone(store.timezone, CURRENT_TIMESTAMP)::DATE
        THEN 'AGENDADA'
      ELSE 'ATIVA'
    END,
    campaign.lock_version,
    campaign.created_at,
    campaign.updated_at
  FROM metas.campaigns campaign
  JOIN metas.stores store ON store.id = campaign.store_id
  WHERE campaign.id = new_campaign_id;
END
$function$;

CREATE OR REPLACE FUNCTION metas.manager_update_campaign(
  target_campaign_id UUID,
  campaign_name TEXT,
  campaign_target_quantity INTEGER,
  campaign_target_amount_cents BIGINT,
  campaign_start_date DATE,
  campaign_end_date DATE,
  expected_lock_version INTEGER
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  target_quantity INTEGER,
  sold_quantity INTEGER,
  target_amount_cents TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT,
  lock_version INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_closed_at TIMESTAMPTZ;
  current_lock_version INTEGER;
  manager_store_id UUID;
  normalized_name TEXT;
BEGIN
  manager_store_id := metas.require_manager_store();
  normalized_name := btrim(campaign_name);

  IF normalized_name IS NULL OR char_length(normalized_name) NOT BETWEEN 2 AND 120
    OR (
      campaign_target_quantity IS NOT NULL
      AND campaign_target_quantity NOT BETWEEN 1 AND 1000000000
    )
    OR campaign_target_amount_cents IS NULL
    OR campaign_target_amount_cents NOT BETWEEN 1 AND 9007199254740991
    OR campaign_start_date IS NULL
    OR campaign_end_date IS NULL
    OR campaign_end_date < campaign_start_date
    OR expected_lock_version IS NULL OR expected_lock_version <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_CAMPAIGN';
  END IF;

  SELECT campaign.closed_at, campaign.lock_version
  INTO current_closed_at, current_lock_version
  FROM metas.campaigns campaign
  WHERE campaign.id = target_campaign_id
    AND campaign.store_id = manager_store_id
  FOR UPDATE;

  IF current_lock_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CAMPAIGN_NOT_FOUND';
  END IF;
  IF current_closed_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CAMPAIGN_CLOSED';
  END IF;
  IF current_lock_version <> expected_lock_version THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'CAMPAIGN_CONFLICT';
  END IF;

  UPDATE metas.campaigns campaign
  SET name = normalized_name,
      target_quantity = campaign_target_quantity,
      target_amount_cents = campaign_target_amount_cents,
      start_date = campaign_start_date,
      end_date = campaign_end_date,
      lock_version = campaign.lock_version + 1
  WHERE campaign.id = target_campaign_id
    AND campaign.store_id = manager_store_id;

  RETURN QUERY
  SELECT
    campaign.id,
    campaign.name,
    campaign.target_quantity,
    campaign.sold_quantity,
    campaign.target_amount_cents::TEXT,
    campaign.start_date,
    campaign.end_date,
    CASE
      WHEN campaign.closed_at IS NOT NULL
        OR campaign.end_date < timezone(store.timezone, CURRENT_TIMESTAMP)::DATE
        THEN 'ENCERRADA'
      WHEN campaign.start_date > timezone(store.timezone, CURRENT_TIMESTAMP)::DATE
        THEN 'AGENDADA'
      ELSE 'ATIVA'
    END,
    campaign.lock_version,
    campaign.created_at,
    campaign.updated_at
  FROM metas.campaigns campaign
  JOIN metas.stores store ON store.id = campaign.store_id
  WHERE campaign.id = target_campaign_id;
END
$function$;

REVOKE EXECUTE ON FUNCTION metas.manager_create_campaign(TEXT, INTEGER, BIGINT, DATE, DATE)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION metas.manager_update_campaign(
  UUID, TEXT, INTEGER, BIGINT, DATE, DATE, INTEGER
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION metas.manager_create_campaign(TEXT, INTEGER, BIGINT, DATE, DATE)
  TO metas_app_runtime;
GRANT EXECUTE ON FUNCTION metas.manager_update_campaign(
  UUID, TEXT, INTEGER, BIGINT, DATE, DATE, INTEGER
) TO metas_app_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
