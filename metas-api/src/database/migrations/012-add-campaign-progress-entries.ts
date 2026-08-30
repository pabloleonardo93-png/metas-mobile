import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
CREATE UNIQUE INDEX campaigns_id_store_unique_idx
  ON metas.campaigns (id, store_id);

CREATE TABLE metas.campaign_progress_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL,
  campaign_id UUID NOT NULL,
  amount_cents BIGINT NOT NULL,
  quantity INTEGER NULL,
  created_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT campaign_progress_entries_campaign_store_fk
    FOREIGN KEY (campaign_id, store_id)
    REFERENCES metas.campaigns (id, store_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT campaign_progress_entries_store_fk FOREIGN KEY (store_id)
    REFERENCES metas.stores (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT campaign_progress_entries_created_by_user_fk FOREIGN KEY (created_by_user_id)
    REFERENCES metas.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT campaign_progress_entries_amount_valid CHECK (
    amount_cents BETWEEN 1 AND 9007199254740991
  ),
  CONSTRAINT campaign_progress_entries_quantity_valid CHECK (
    quantity IS NULL OR quantity BETWEEN 1 AND 1000000000
  )
);

CREATE INDEX campaign_progress_entries_store_campaign_created_idx
  ON metas.campaign_progress_entries (store_id, campaign_id, created_at DESC, id DESC);

ALTER TABLE metas.campaign_progress_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas.campaign_progress_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY campaign_progress_entries_owner_all ON metas.campaign_progress_entries
  FOR ALL TO metas_migration_owner USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY campaign_progress_entries_runtime_select ON metas.campaign_progress_entries
  FOR SELECT TO metas_app_runtime
  USING (
    metas.has_active_database_context()
    AND store_id = metas.safe_context_uuid('app.current_store_id')
  );

REVOKE ALL ON TABLE metas.campaign_progress_entries FROM PUBLIC;
GRANT SELECT ON TABLE metas.campaign_progress_entries TO metas_app_runtime;

CREATE FUNCTION metas.manager_create_campaign_progress_entry(
  target_campaign_id UUID,
  progress_amount_cents BIGINT,
  progress_quantity INTEGER
)
RETURNS TABLE (
  id UUID,
  campaign_id UUID,
  amount_cents TEXT,
  quantity INTEGER,
  created_by_user_id UUID,
  created_by_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  campaign_closed_at TIMESTAMPTZ;
  campaign_end_date DATE;
  campaign_target_quantity INTEGER;
  manager_store_id UUID;
  manager_user_id UUID;
  new_entry_id UUID;
  store_timezone TEXT;
BEGIN
  manager_store_id := metas.require_manager_store();
  manager_user_id := metas.safe_context_uuid('app.current_user_id');

  IF progress_amount_cents IS NULL
    OR progress_amount_cents NOT BETWEEN 1 AND 9007199254740991
    OR (
      progress_quantity IS NOT NULL
      AND progress_quantity NOT BETWEEN 1 AND 1000000000
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_CAMPAIGN_PROGRESS';
  END IF;

  SELECT campaign.target_quantity, campaign.closed_at, campaign.end_date, store.timezone
  INTO campaign_target_quantity, campaign_closed_at, campaign_end_date, store_timezone
  FROM metas.campaigns campaign
  JOIN metas.stores store ON store.id = campaign.store_id
  WHERE campaign.id = target_campaign_id
    AND campaign.store_id = manager_store_id
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CAMPAIGN_NOT_FOUND';
  END IF;
  IF campaign_closed_at IS NOT NULL
    OR campaign_end_date < timezone(store_timezone, CURRENT_TIMESTAMP)::DATE THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CAMPAIGN_CLOSED';
  END IF;
  IF campaign_target_quantity IS NULL AND progress_quantity IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CAMPAIGN_QUANTITY_NOT_TRACKED';
  END IF;

  INSERT INTO metas.campaign_progress_entries (
    store_id,
    campaign_id,
    amount_cents,
    quantity,
    created_by_user_id
  ) VALUES (
    manager_store_id,
    target_campaign_id,
    progress_amount_cents,
    progress_quantity,
    manager_user_id
  )
  RETURNING metas.campaign_progress_entries.id INTO new_entry_id;

  RETURN QUERY
  SELECT
    entry.id,
    entry.campaign_id,
    entry.amount_cents::TEXT,
    entry.quantity,
    entry.created_by_user_id,
    creator.full_name,
    entry.created_at
  FROM metas.campaign_progress_entries entry
  JOIN metas.users creator ON creator.id = entry.created_by_user_id
  WHERE entry.id = new_entry_id;
END
$function$;

REVOKE EXECUTE ON FUNCTION metas.manager_create_campaign_progress_entry(UUID, BIGINT, INTEGER)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION metas.manager_create_campaign_progress_entry(UUID, BIGINT, INTEGER)
  TO metas_app_runtime;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
