import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import { createMigrator } from '../src/database/umzug.js';
import type { AuthenticatedSession } from '../src/modules/auth/auth.types.js';
import { PostgresCampaignService } from '../src/modules/campaigns/campaignService.js';
import type { CampaignMutationInput } from '../src/modules/campaigns/campaign.types.js';
import { withDatabaseContext } from '../src/shared/database/withDatabaseContext.js';
import { AppError } from '../src/shared/errors/AppError.js';
import { createIntegrationDatabases } from './integrationDatabase.js';

interface ManagerFixture {
  session: AuthenticatedSession;
  storeId: string;
}

const withMigrationOwner = async <Result>(
  database: Sequelize,
  callback: (transaction: Transaction) => Promise<Result>,
): Promise<Result> =>
  database.transaction(async (transaction) => {
    await database.query('SET LOCAL ROLE metas_migration_owner', { transaction });
    return callback(transaction);
  });

const createManagerFixture = async (
  database: Sequelize,
  label: string,
): Promise<ManagerFixture> => {
  const storeId = randomUUID();
  const userId = randomUUID();
  const employeeId = await withMigrationOwner(database, async (transaction) => {
    await database.query(
      `INSERT INTO metas.stores (id, name, slug)
       VALUES (:storeId, :name, :slug)`,
      {
        replacements: { name: `Campaign Store ${label}`, slug: `${label}-${storeId}`, storeId },
        transaction,
      },
    );
    await database.query(
      `INSERT INTO metas.users (id, full_name, primary_email, account_status)
       VALUES (:userId, :name, :email, 'ACTIVE')`,
      {
        replacements: {
          email: `campaign-manager-${label}-${userId}@example.test`,
          name: `Campaign Manager ${label}`,
          userId,
        },
        transaction,
      },
    );
    const rows = await database.query<{ employeeId: string }>(
      `SELECT metas.bootstrap_first_manager(:storeId, :userId, CURRENT_DATE) AS "employeeId"`,
      { replacements: { storeId, userId }, transaction, type: QueryTypes.SELECT },
    );
    assert.ok(rows[0]?.employeeId);
    return rows[0].employeeId;
  });

  return {
    session: {
      employeeId,
      role: 'GESTOR',
      storeId,
      tokenHash: Buffer.alloc(32),
      userId,
    },
    storeId,
  };
};

const addDays = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const campaignInput = (name: string): CampaignMutationInput => ({
  endDate: addDays(2),
  name,
  startDate: addDays(-1),
  targetAmountCents: '50000056',
  targetQuantity: 50,
});

const testDatabases = createIntegrationDatabases(4, 3);

if (testDatabases === null) {
  await test('campaign integration tests require dedicated test URLs', {
    skip: 'TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are not configured.',
  });
} else {
  const { migrationDatabase, runtimeDatabase } = testDatabases;
  const service = new PostgresCampaignService(runtimeDatabase);

  try {
    await migrationDatabase.authenticate();
    await runtimeDatabase.authenticate();
    await createMigrator(migrationDatabase).up();

    await test('manager creates, updates and closes a persisted campaign', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'crud');
      const created = await service.create(manager.session, campaignInput('Campanha CRUD'));
      assert.equal(created.soldQuantity, 0);
      assert.equal(created.status, 'ATIVA');
      assert.equal(created.targetAmountCents, '50000056');

      const updated = await service.update(
        manager.session,
        created.id,
        { ...campaignInput('Campanha atualizada'), targetQuantity: 75 },
        created.lockVersion,
      );
      assert.equal(updated.targetQuantity, 75);
      assert.equal(updated.lockVersion, created.lockVersion + 1);

      const closed = await service.close(manager.session, created.id, updated.lockVersion);
      assert.equal(closed.status, 'ENCERRADA');
      assert.equal(closed.lockVersion, updated.lockVersion + 1);
      assert.deepEqual(await service.getById(manager.session, created.id), closed);
    });

    await test('manager persists a campaign with or without quantity control', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'optional-quantity');
      const withoutQuantity = await service.create(manager.session, {
        ...campaignInput('Campanha sem quantidade'),
        targetQuantity: null,
      });
      assert.equal(withoutQuantity.targetQuantity, null);

      const withQuantity = await service.update(
        manager.session,
        withoutQuantity.id,
        { ...campaignInput('Campanha com quantidade'), targetQuantity: 80 },
        withoutQuantity.lockVersion,
      );
      assert.equal(withQuantity.targetQuantity, 80);

      const disabledAgain = await service.update(
        manager.session,
        withQuantity.id,
        { ...campaignInput('Campanha novamente sem quantidade'), targetQuantity: null },
        withQuantity.lockVersion,
      );
      assert.equal(disabledAgain.targetQuantity, null);
      assert.equal((await service.getById(manager.session, disabledAgain.id)).targetQuantity, null);
    });

    await test('campaign status is derived from dates and explicit closure', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'status');
      const scheduled = await service.create(manager.session, {
        ...campaignInput('Campanha agendada'),
        endDate: addDays(3),
        startDate: addDays(2),
      });
      const ended = await service.create(manager.session, {
        ...campaignInput('Campanha encerrada pela data'),
        endDate: addDays(-1),
        startDate: addDays(-3),
      });
      assert.equal(scheduled.status, 'AGENDADA');
      assert.equal(ended.status, 'ENCERRADA');
    });

    await test('RLS and controlled mutations isolate campaigns by store', async () => {
      const storeA = await createManagerFixture(migrationDatabase, 'store-a');
      const storeB = await createManagerFixture(migrationDatabase, 'store-b');
      const campaignA = await service.create(storeA.session, campaignInput('Campanha A'));
      const campaignB = await service.create(storeB.session, campaignInput('Campanha B'));

      assert.deepEqual(
        (await service.list(storeA.session)).map(({ id }) => id),
        [campaignA.id],
      );
      assert.deepEqual(
        (await service.list(storeB.session)).map(({ id }) => id),
        [campaignB.id],
      );
      await assert.rejects(
        service.getById(storeA.session, campaignB.id),
        (error: unknown) => error instanceof AppError && error.statusCode === 404,
      );
      await assert.rejects(
        service.update(
          storeA.session,
          campaignB.id,
          campaignInput('Tentativa cross-store'),
          campaignB.lockVersion,
        ),
        (error: unknown) => error instanceof AppError && error.statusCode === 404,
      );
    });

    await test('non-manager and invalid campaign data are rejected', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'validation');
      await assert.rejects(
        service.create({ ...manager.session, role: 'CAIXA' }, campaignInput('Sem permissão')),
        (error: unknown) => error instanceof AppError && error.statusCode === 403,
      );
      await assert.rejects(
        service.create(manager.session, { ...campaignInput('Inválida'), targetQuantity: 0 }),
        (error: unknown) => error instanceof AppError && error.statusCode === 422,
      );
      await assert.rejects(
        service.create(manager.session, {
          ...campaignInput('Datas inválidas'),
          endDate: addDays(-2),
          startDate: addDays(1),
        }),
        (error: unknown) => error instanceof AppError && error.statusCode === 422,
      );
    });

    await test('campaign RLS, function hardening and runtime privileges remain minimal', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'security');
      const campaign = await service.create(manager.session, campaignInput('Campanha segura'));

      const withoutContext = await runtimeDatabase.query<{ id: string }>(
        'SELECT id FROM metas.campaigns',
        { type: QueryTypes.SELECT },
      );
      assert.deepEqual(withoutContext, []);

      await assert.rejects(
        withDatabaseContext(
          runtimeDatabase,
          {
            employeeId: manager.session.employeeId,
            storeId: manager.session.storeId,
            userId: manager.session.userId,
          },
          (transaction) =>
            runtimeDatabase.query(
              'UPDATE metas.campaigns SET sold_quantity = 1 WHERE id = :campaignId',
              { replacements: { campaignId: campaign.id }, transaction },
            ),
        ),
      );

      const security = await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query<{
          forceRls: boolean;
          owner: string;
          publicExecute: boolean;
          rowSecurity: boolean;
          runtimeDml: boolean;
          searchPath: string[];
          securityDefiner: boolean;
        }>(
          `SELECT
             owner.rolname AS owner,
             procedure.prosecdef AS "securityDefiner",
             procedure.proconfig AS "searchPath",
             has_function_privilege('public', procedure.oid, 'EXECUTE') AS "publicExecute",
             relation.relrowsecurity AS "rowSecurity",
             relation.relforcerowsecurity AS "forceRls",
             has_table_privilege('metas_app_runtime', 'metas.campaigns', 'INSERT,UPDATE,DELETE')
               AS "runtimeDml"
           FROM pg_proc procedure
           JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
           JOIN pg_roles owner ON owner.oid = procedure.proowner
           CROSS JOIN pg_class relation
           JOIN pg_namespace table_namespace ON table_namespace.oid = relation.relnamespace
           WHERE namespace.nspname = 'metas'
             AND procedure.proname IN (
               'manager_create_campaign', 'manager_update_campaign', 'manager_close_campaign'
             )
             AND table_namespace.nspname = 'metas'
             AND relation.relname = 'campaigns'
           ORDER BY procedure.proname`,
          { transaction, type: QueryTypes.SELECT },
        ),
      );
      assert.equal(security.length, 3);
      for (const item of security) {
        assert.equal(item.owner, 'metas_migration_owner');
        assert.equal(item.securityDefiner, true);
        assert.deepEqual(item.searchPath, ['search_path=pg_catalog']);
        assert.equal(item.publicExecute, false);
        assert.equal(item.rowSecurity, true);
        assert.equal(item.forceRls, true);
        assert.equal(item.runtimeDml, false);
      }
    });
  } finally {
    await Promise.all([migrationDatabase.close(), runtimeDatabase.close()]);
  }
}
