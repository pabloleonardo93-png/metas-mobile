import type { Sequelize } from 'sequelize';
import type { MigrationParams } from 'umzug';

import { runMigration } from './migrationUtils.js';

const sql = `
CREATE TYPE metas.employee_role AS ENUM (
  'GESTOR',
  'BALCONISTA',
  'CAIXA',
  'FARMACEUTICO'
);

CREATE FUNCTION metas.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, metas
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

CREATE TABLE metas.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug public.CITEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stores_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT stores_slug_not_blank CHECK (btrim(slug::TEXT) <> ''),
  CONSTRAINT stores_timezone_not_blank CHECK (btrim(timezone) <> ''),
  CONSTRAINT stores_slug_unique UNIQUE (slug)
);

CREATE TABLE metas.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  primary_email public.CITEXT NOT NULL,
  account_status TEXT NOT NULL DEFAULT 'PENDING',
  email_verified_at TIMESTAMPTZ NULL,
  lock_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_full_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT users_primary_email_not_blank CHECK (btrim(primary_email::TEXT) <> ''),
  CONSTRAINT users_account_status_valid
    CHECK (account_status IN ('PENDING', 'ACTIVE', 'DISABLED')),
  CONSTRAINT users_lock_version_positive CHECK (lock_version > 0),
  CONSTRAINT users_primary_email_unique UNIQUE (primary_email)
);

CREATE TABLE metas.auth_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  provider_email public.CITEXT NULL,
  provider_verified_at TIMESTAMPTZ NULL,
  last_sign_in_at TIMESTAMPTZ NULL,
  disabled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_identities_provider_google_only CHECK (provider = 'GOOGLE'),
  CONSTRAINT auth_identities_subject_not_blank CHECK (btrim(provider_subject) <> ''),
  CONSTRAINT auth_identities_provider_email_not_blank
    CHECK (provider_email IS NULL OR btrim(provider_email::TEXT) <> ''),
  CONSTRAINT auth_identities_user_fk FOREIGN KEY (user_id)
    REFERENCES metas.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT auth_identities_provider_subject_unique UNIQUE (provider, provider_subject),
  CONSTRAINT auth_identities_user_provider_unique UNIQUE (user_id, provider),
  CONSTRAINT auth_identities_id_user_unique UNIQUE (id, user_id)
);

CREATE TABLE metas.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role metas.employee_role NOT NULL,
  status TEXT NOT NULL DEFAULT 'ATIVO',
  joined_on DATE NOT NULL,
  ended_on DATE NULL,
  created_by_user_id UUID NULL,
  creation_source TEXT NOT NULL DEFAULT 'MANAGER',
  lock_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employees_status_valid CHECK (status IN ('ATIVO', 'INATIVO')),
  CONSTRAINT employees_creation_source_valid
    CHECK (creation_source IN ('BOOTSTRAP', 'MANAGER', 'IMPORT')),
  CONSTRAINT employees_joined_ended_order
    CHECK (ended_on IS NULL OR ended_on >= joined_on),
  CONSTRAINT employees_creation_actor_valid CHECK (
    (creation_source = 'BOOTSTRAP' AND created_by_user_id IS NULL)
    OR
    (creation_source <> 'BOOTSTRAP' AND created_by_user_id IS NOT NULL)
  ),
  CONSTRAINT employees_lock_version_positive CHECK (lock_version > 0),
  CONSTRAINT employees_store_fk FOREIGN KEY (store_id)
    REFERENCES metas.stores (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT employees_user_fk FOREIGN KEY (user_id)
    REFERENCES metas.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT employees_created_by_user_fk FOREIGN KEY (created_by_user_id)
    REFERENCES metas.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT employees_store_user_unique UNIQUE (store_id, user_id),
  CONSTRAINT employees_id_store_unique UNIQUE (id, store_id),
  CONSTRAINT employees_id_user_unique UNIQUE (id, user_id)
);

CREATE TABLE metas.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  auth_identity_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  ip_address INET NULL,
  user_agent TEXT NULL,
  CONSTRAINT sessions_expiration_after_creation CHECK (expires_at > created_at),
  CONSTRAINT sessions_last_seen_after_creation CHECK (last_seen_at >= created_at),
  CONSTRAINT sessions_revoked_after_creation CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id)
    REFERENCES metas.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sessions_employee_user_fk FOREIGN KEY (employee_id, user_id)
    REFERENCES metas.employees (id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sessions_identity_user_fk FOREIGN KEY (auth_identity_id, user_id)
    REFERENCES metas.auth_identities (id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX employees_store_status_idx ON metas.employees (store_id, status);
CREATE INDEX employees_store_role_status_idx ON metas.employees (store_id, role, status);
CREATE INDEX employees_user_idx ON metas.employees (user_id);
CREATE INDEX auth_identities_user_idx ON metas.auth_identities (user_id);
CREATE INDEX auth_identities_provider_email_idx ON metas.auth_identities (provider_email);
CREATE INDEX sessions_user_expiration_idx ON metas.sessions (user_id, expires_at);
CREATE INDEX sessions_employee_idx ON metas.sessions (employee_id);
CREATE INDEX sessions_active_expiration_idx ON metas.sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE TRIGGER stores_set_updated_at
BEFORE UPDATE ON metas.stores
FOR EACH ROW EXECUTE FUNCTION metas.set_updated_at();
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON metas.users
FOR EACH ROW EXECUTE FUNCTION metas.set_updated_at();
CREATE TRIGGER auth_identities_set_updated_at
BEFORE UPDATE ON metas.auth_identities
FOR EACH ROW EXECUTE FUNCTION metas.set_updated_at();
CREATE TRIGGER employees_set_updated_at
BEFORE UPDATE ON metas.employees
FOR EACH ROW EXECUTE FUNCTION metas.set_updated_at();

REVOKE EXECUTE ON FUNCTION metas.set_updated_at() FROM PUBLIC;
`;

export const up = async ({ context }: MigrationParams<Sequelize>): Promise<void> => {
  await runMigration(context, sql);
};
