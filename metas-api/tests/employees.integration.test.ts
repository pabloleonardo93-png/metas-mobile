import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import { createMigrator } from '../src/database/umzug.js';
import type { AuthenticatedSession, UserRole } from '../src/modules/auth/auth.types.js';
import { PostgresEmployeeService } from '../src/modules/employees/employeeService.js';
import type { EmployeeMutationInput } from '../src/modules/employees/employee.types.js';
import { AppError } from '../src/shared/errors/AppError.js';
import { createIntegrationDatabases } from './integrationDatabase.js';

interface ManagerFixture {
  employeeId: string;
  session: AuthenticatedSession;
  storeId: string;
  userId: string;
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
        replacements: { name: `Employee Store ${label}`, slug: `${label}-${storeId}`, storeId },
        transaction,
      },
    );
    await database.query(
      `INSERT INTO metas.users (id, full_name, primary_email, account_status)
       VALUES (:userId, :name, :email, 'ACTIVE')`,
      {
        replacements: {
          email: `manager-${label}-${userId}@example.test`,
          name: `Manager ${label}`,
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
    employeeId,
    session: {
      employeeId,
      role: 'GESTOR',
      storeId,
      tokenHash: Buffer.alloc(32),
      userId,
    },
    storeId,
    userId,
  };
};

const employeeInput = (label: string, role: UserRole = 'BALCONISTA'): EmployeeMutationInput => ({
  email: `${label}-${randomUUID()}@example.test`,
  joinedOn: '2026-08-13',
  name: `Employee ${label}`,
  role,
  status: 'ATIVO',
});

const testDatabases = createIntegrationDatabases(4, 3);

if (testDatabases === null) {
  await test('employee integration tests require dedicated test URLs', {
    skip: 'TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are not configured.',
  });
} else {
  const { migrationDatabase, runtimeDatabase } = testDatabases;
  const service = new PostgresEmployeeService(runtimeDatabase);

  try {
    await migrationDatabase.authenticate();
    await runtimeDatabase.authenticate();
    await createMigrator(migrationDatabase).up();

    await test('manager CRUD persists users and employees without auth identity', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'crud');
      const input = employeeInput('crud');
      const created = await service.create(manager.session, input);
      assert.equal(created.email, input.email);

      const stored = await withMigrationOwner(migrationDatabase, async (transaction) => {
        const rows = await migrationDatabase.query<{
          accountStatus: string;
          identityCount: string;
          sessionCount: string;
          status: string;
        }>(
          `SELECT
             app_user.account_status AS "accountStatus",
             employee.status,
             (SELECT count(*) FROM metas.auth_identities identity
               WHERE identity.user_id = app_user.id)::TEXT AS "identityCount",
             (SELECT count(*) FROM metas.sessions session
               WHERE session.user_id = app_user.id)::TEXT AS "sessionCount"
           FROM metas.employees employee
           JOIN metas.users app_user ON app_user.id = employee.user_id
           WHERE employee.id = :employeeId`,
          { replacements: { employeeId: created.id }, transaction, type: QueryTypes.SELECT },
        );
        return rows[0];
      });
      assert.equal(stored?.accountStatus, 'PENDING');
      assert.equal(stored?.identityCount, '0');
      assert.equal(stored?.sessionCount, '0');

      const updated = await service.update(manager.session, created.id, {
        ...input,
        name: 'Employee Updated',
        role: 'FARMACEUTICO',
      });
      assert.equal(updated.name, 'Employee Updated');
      assert.equal(updated.role, 'FARMACEUTICO');

      const inactive = await service.setStatus(manager.session, created.id, 'INATIVO');
      assert.equal(inactive.status, 'INATIVO');
      assert.equal((await service.getById(manager.session, created.id)).status, 'INATIVO');
    });

    await test('RLS context and controlled functions isolate stores', async () => {
      const storeA = await createManagerFixture(migrationDatabase, 'store-a');
      const storeB = await createManagerFixture(migrationDatabase, 'store-b');
      const employeeA = await service.create(storeA.session, employeeInput('employee-a'));
      const employeeB = await service.create(storeB.session, employeeInput('employee-b'));

      const listA = await service.list(storeA.session);
      assert.ok(listA.some((employee) => employee.id === employeeA.id));
      assert.ok(!listA.some((employee) => employee.id === employeeB.id));

      await assert.rejects(
        service.getById(storeA.session, employeeB.id),
        (error: unknown) => error instanceof AppError && error.statusCode === 404,
      );
    });

    await test('non-manager and duplicate email are rejected', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'authorization');
      const input = employeeInput('duplicate');
      await service.create(manager.session, input);

      await assert.rejects(
        service.create(manager.session, input),
        (error: unknown) =>
          error instanceof AppError &&
          error.statusCode === 409 &&
          error.code === 'EMPLOYEE_ALREADY_EXISTS',
      );

      await assert.rejects(
        service.list({ ...manager.session, role: 'CAIXA' }),
        (error: unknown) => error instanceof AppError && error.statusCode === 403,
      );
    });

    await test('manager cannot remove own access or the last active manager', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'last-manager');
      await assert.rejects(
        service.setStatus(manager.session, manager.employeeId, 'INATIVO'),
        (error: unknown) =>
          error instanceof AppError &&
          error.statusCode === 409 &&
          error.code === 'SELF_MANAGER_ACCESS_CHANGE_FORBIDDEN',
      );

      const activeManagers = await withMigrationOwner(migrationDatabase, async (transaction) =>
        migrationDatabase.query<{ count: string }>(
          `SELECT count(*)::TEXT AS count
           FROM metas.employees
           WHERE store_id = :storeId AND role = 'GESTOR' AND status = 'ATIVO'`,
          { replacements: { storeId: manager.storeId }, transaction, type: QueryTypes.SELECT },
        ),
      );
      assert.equal(activeManagers[0]?.count, '1');
    });
  } finally {
    await Promise.all([migrationDatabase.close(), runtimeDatabase.close()]);
  }
}
