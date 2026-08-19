import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import { createMigrator } from '../src/database/umzug.js';
import type { AuthenticatedSession } from '../src/modules/auth/auth.types.js';
import { PostgresEmployeeService } from '../src/modules/employees/employeeService.js';
import { PostgresGoalService } from '../src/modules/goals/goalService.js';
import type { SaveManagerGoalConfigurationInput } from '../src/modules/goals/goal.types.js';
import { AppError } from '../src/shared/errors/AppError.js';
import { withDatabaseContext } from '../src/shared/database/withDatabaseContext.js';
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
        replacements: { name: `Goal Store ${label}`, slug: `${label}-${storeId}`, storeId },
        transaction,
      },
    );
    await database.query(
      `INSERT INTO metas.users (id, full_name, primary_email, account_status)
       VALUES (:userId, :name, :email, 'ACTIVE')`,
      {
        replacements: {
          email: `goal-manager-${label}-${userId}@example.test`,
          name: `Goal Manager ${label}`,
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

const configurationInput = (
  expectedLockVersion: number | null = null,
  overrides: Partial<SaveManagerGoalConfigurationInput> = {},
): SaveManagerGoalConfigurationInput => ({
  expectedLockVersion,
  monthlyTargetCents: '50000056',
  remainingBusinessDays: 12,
  roleWeights: [
    { role: 'BALCONISTA', weight: '1.0' },
    { role: 'FARMACEUTICO', weight: '0.7' },
    { role: 'CAIXA', weight: '0.3' },
  ],
  soldAmountCents: '125099',
  totalBusinessDays: 22,
  ...overrides,
});

const testDatabases = createIntegrationDatabases(4, 3);

if (testDatabases === null) {
  await test('goal integration tests require dedicated test URLs', {
    skip: 'TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are not configured.',
  });
} else {
  const { migrationDatabase, runtimeDatabase } = testDatabases;
  const goalService = new PostgresGoalService(runtimeDatabase);
  const employeeService = new PostgresEmployeeService(runtimeDatabase);

  try {
    await migrationDatabase.authenticate();
    await runtimeDatabase.authenticate();
    await createMigrator(migrationDatabase).up();

    await test('manager saves and reloads cents with server-derived employee snapshots', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'persistence');
      await employeeService.create(manager.session, {
        email: `goal-balconista-${randomUUID()}@example.test`,
        joinedOn: '2026-08-13',
        name: 'Goal Balconista',
        role: 'BALCONISTA',
        status: 'ATIVO',
      });

      const saved = await goalService.saveConfiguration(manager.session, configurationInput());
      assert.equal(saved.monthlyTargetCents, '50000056');
      assert.equal(saved.soldAmountCents, '125099');
      assert.equal(saved.roles.find(({ role }) => role === 'BALCONISTA')?.employeeCountSnapshot, 1);

      const loaded = await goalService.getConfiguration(manager.session);
      assert.deepEqual(loaded, saved);

      const counts = await withMigrationOwner(migrationDatabase, async (transaction) =>
        migrationDatabase.query<{ currentGoals: string; roleSnapshots: string }>(
          `SELECT
             (SELECT count(*) FROM metas.goals goal
               WHERE goal.store_id = :storeId AND goal.valid_until IS NULL)::TEXT AS "currentGoals",
             (SELECT count(*) FROM metas.goal_roles goal_role
               WHERE goal_role.goal_id = :goalId)::TEXT AS "roleSnapshots"`,
          {
            replacements: { goalId: saved.id, storeId: manager.storeId },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      assert.equal(counts[0]?.currentGoals, '1');
      assert.equal(counts[0]?.roleSnapshots, '3');
    });

    await test('manager persists sold amounts below, equal to, and above the monthly target', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'sold-progress');
      const soldAmounts = ['25000000', '50050500', '60000000', '250506556'];
      let expectedLockVersion: number | null = null;

      for (const soldAmountCents of soldAmounts) {
        const saved = await goalService.saveConfiguration(
          manager.session,
          configurationInput(expectedLockVersion, {
            monthlyTargetCents: '50050500',
            remainingBusinessDays: 13,
            soldAmountCents,
            totalBusinessDays: 31,
          }),
        );
        assert.equal(saved.monthlyTargetCents, '50050500');
        assert.equal(saved.soldAmountCents, soldAmountCents);
        assert.equal(saved.remainingBusinessDays, 13);
        assert.equal(saved.totalBusinessDays, 31);
        expectedLockVersion = saved.lockVersion;
      }

      const loaded = await goalService.getConfiguration(manager.session);
      assert.equal(loaded.monthlyTargetCents, '50050500');
      assert.equal(loaded.soldAmountCents, '250506556');
      assert.equal(loaded.remainingBusinessDays, 13);
      assert.equal(loaded.totalBusinessDays, 31);
    });

    await test('goal configuration rejects non-manager and stale concurrent writes', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'concurrency');
      const first = await goalService.saveConfiguration(manager.session, configurationInput());
      assert.ok(first.lockVersion);
      const second = await goalService.saveConfiguration(
        manager.session,
        configurationInput(first.lockVersion),
      );
      assert.equal(second.lockVersion, (first.lockVersion ?? 0) + 1);

      await assert.rejects(
        goalService.saveConfiguration(manager.session, configurationInput(first.lockVersion)),
        (error: unknown) =>
          error instanceof AppError &&
          error.statusCode === 409 &&
          error.code === 'GOAL_CONFIGURATION_CONFLICT',
      );
      await assert.rejects(
        goalService.getConfiguration({ ...manager.session, role: 'CAIXA' }),
        (error: unknown) => error instanceof AppError && error.statusCode === 403,
      );
    });

    await test('RLS and controlled functions isolate goal configurations by store', async () => {
      const storeA = await createManagerFixture(migrationDatabase, 'store-a');
      const storeB = await createManagerFixture(migrationDatabase, 'store-b');
      const goalA = await goalService.saveConfiguration(storeA.session, configurationInput());
      const goalB = await goalService.saveConfiguration(storeB.session, {
        ...configurationInput(),
        monthlyTargetCents: '90000099',
      });
      assert.notEqual(goalA.id, goalB.id);
      assert.equal(
        (await goalService.getConfiguration(storeA.session)).monthlyTargetCents,
        '50000056',
      );
      assert.equal(
        (await goalService.getConfiguration(storeB.session)).monthlyTargetCents,
        '90000099',
      );

      const rowsA = await withDatabaseContext(
        runtimeDatabase,
        {
          employeeId: storeA.session.employeeId,
          storeId: storeA.session.storeId,
          userId: storeA.session.userId,
        },
        (transaction) =>
          runtimeDatabase.query<{ id: string }>('SELECT id FROM metas.goals', {
            transaction,
            type: QueryTypes.SELECT,
          }),
      );
      assert.deepEqual(
        rowsA.map(({ id }) => id),
        [goalA.id],
      );
    });

    await test('goal functions remain hardened and runtime has no direct DML', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'security');
      const saved = await goalService.saveConfiguration(manager.session, configurationInput());

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
              `UPDATE metas.goals SET monthly_target_cents = 1 WHERE id = :goalId`,
              { replacements: { goalId: saved.id }, transaction },
            ),
        ),
      );

      const functions = await withMigrationOwner(migrationDatabase, async (transaction) =>
        migrationDatabase.query<{
          isSecurityDefiner: boolean;
          owner: string;
          publicExecute: boolean;
          searchPath: string[];
        }>(
          `SELECT
             owner.rolname AS owner,
             procedure.prosecdef AS "isSecurityDefiner",
             procedure.proconfig AS "searchPath",
             has_function_privilege('public', procedure.oid, 'EXECUTE') AS "publicExecute"
           FROM pg_proc procedure
           JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
           JOIN pg_roles owner ON owner.oid = procedure.proowner
           WHERE namespace.nspname = 'metas'
             AND procedure.proname IN (
               'manager_get_goal_configuration',
               'manager_save_goal_configuration'
             )
           ORDER BY procedure.proname`,
          { transaction, type: QueryTypes.SELECT },
        ),
      );
      assert.equal(functions.length, 2);
      for (const fn of functions) {
        assert.equal(fn.owner, 'metas_migration_owner');
        assert.equal(fn.isSecurityDefiner, true);
        assert.deepEqual(fn.searchPath, ['search_path=pg_catalog']);
        assert.equal(fn.publicExecute, false);
      }
    });
  } finally {
    await Promise.all([migrationDatabase.close(), runtimeDatabase.close()]);
  }
}
