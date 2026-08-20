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
        email: `updated-${input.email}`,
        name: 'Employee Updated',
        role: 'FARMACEUTICO',
      });
      assert.equal(updated.email, `updated-${input.email}`);
      assert.equal(updated.googleLinked, false);
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

    await test('linked access email requires the explicit same-store operation', async () => {
      const storeA = await createManagerFixture(migrationDatabase, 'access-store-a');
      const storeB = await createManagerFixture(migrationDatabase, 'access-store-b');
      const target = await service.create(storeA.session, employeeInput('linked-access', 'GESTOR'));
      const targetUser = await withMigrationOwner(migrationDatabase, async (transaction) => {
        const rows = await migrationDatabase.query<{ userId: string }>(
          'SELECT user_id AS "userId" FROM metas.employees WHERE id = :employeeId',
          {
            replacements: { employeeId: target.id },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        assert.ok(rows[0]?.userId);
        await migrationDatabase.query(
          `INSERT INTO metas.auth_identities (
            user_id, provider, provider_subject, provider_email, provider_verified_at
          ) VALUES (:userId, 'GOOGLE', :subject, :email, now())`,
          {
            replacements: {
              email: target.email,
              subject: `linked-${randomUUID()}`,
              userId: rows[0].userId,
            },
            transaction,
          },
        );
        return rows[0].userId;
      });

      const linked = await service.getById(storeA.session, target.id);
      assert.equal(linked.googleLinked, true);
      await assert.rejects(
        service.update(storeA.session, target.id, {
          ...target,
          email: `silent-${target.email}`,
        }),
        (error: unknown) =>
          error instanceof AppError &&
          error.code === 'EMPLOYEE_ACCESS_EMAIL_CHANGE_REQUIRES_EXPLICIT_RESET',
      );
      await assert.rejects(
        service.changeAccessEmail(storeB.session, target.id, {
          email: `cross-store-${randomUUID()}@example.test`,
        }),
        (error: unknown) =>
          error instanceof AppError &&
          error.statusCode === 404 &&
          error.code === 'EMPLOYEE_NOT_FOUND',
      );

      const duplicateEmail = await withMigrationOwner(migrationDatabase, async (transaction) => {
        const rows = await migrationDatabase.query<{ email: string }>(
          'SELECT primary_email::TEXT AS email FROM metas.users WHERE id = :userId',
          {
            replacements: { userId: storeA.userId },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        return rows[0]!.email;
      });
      await assert.rejects(
        service.changeAccessEmail(storeA.session, target.id, { email: duplicateEmail }),
        (error: unknown) =>
          error instanceof AppError &&
          error.statusCode === 409 &&
          error.code === 'EMPLOYEE_ALREADY_EXISTS',
      );

      const linkedEmailOfAnotherUser = `other-linked-${randomUUID()}@example.test`;
      await withMigrationOwner(migrationDatabase, async (transaction) => {
        await migrationDatabase.query(
          `INSERT INTO metas.auth_identities (
            user_id, provider, provider_subject, provider_email, provider_verified_at
          ) VALUES (:userId, 'GOOGLE', :subject, :email, now())`,
          {
            replacements: {
              email: linkedEmailOfAnotherUser,
              subject: `other-linked-${randomUUID()}`,
              userId: storeB.userId,
            },
            transaction,
          },
        );
      });
      await assert.rejects(
        service.changeAccessEmail(storeA.session, target.id, {
          email: linkedEmailOfAnotherUser,
        }),
        (error: unknown) =>
          error instanceof AppError &&
          error.statusCode === 409 &&
          error.code === 'EMPLOYEE_ALREADY_EXISTS',
      );

      const replacementEmail = `replacement-${randomUUID()}@example.test`;
      const changed = await service.changeAccessEmail(storeA.session, target.id, {
        email: `  ${replacementEmail.toUpperCase()}  `,
      });
      assert.equal(changed.email, replacementEmail);
      assert.equal(changed.googleLinked, false);

      const identityState = await withMigrationOwner(migrationDatabase, async (transaction) => {
        const rows = await migrationDatabase.query<{
          active: string;
          disabled: string;
          primaryEmail: string;
        }>(
          `SELECT
             app_user.primary_email::TEXT AS "primaryEmail",
             count(identity.id) FILTER (WHERE identity.disabled_at IS NULL)::TEXT AS active,
             count(identity.id) FILTER (WHERE identity.disabled_at IS NOT NULL)::TEXT AS disabled
           FROM metas.users app_user
           LEFT JOIN metas.auth_identities identity ON identity.user_id = app_user.id
           WHERE app_user.id = :userId
           GROUP BY app_user.id`,
          { replacements: { userId: targetUser }, transaction, type: QueryTypes.SELECT },
        );
        return rows[0];
      });
      assert.deepEqual(identityState, {
        active: '0',
        disabled: '1',
        primaryEmail: replacementEmail,
      });
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

    await test('access email functions and active identity uniqueness remain hardened', async () => {
      const result = await withMigrationOwner(migrationDatabase, async (transaction) => {
        const functions = await migrationDatabase.query<{
          fixedSearchPath: boolean;
          name: string;
          owner: string;
          publicExecute: boolean;
          runtimeExecute: boolean;
          securityDefiner: boolean;
        }>(
          `SELECT
             procedure.proname AS name,
             owner.rolname AS owner,
             procedure.prosecdef AS "securityDefiner",
             procedure.proconfig @> ARRAY['search_path=pg_catalog']::TEXT[]
               AS "fixedSearchPath",
             has_function_privilege('public', procedure.oid, 'EXECUTE') AS "publicExecute",
             has_function_privilege(
               'metas_app_runtime',
               procedure.oid,
               'EXECUTE'
             ) AS "runtimeExecute"
           FROM pg_proc procedure
           JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
           JOIN pg_roles owner ON owner.oid = procedure.proowner
           WHERE namespace.nspname = 'metas'
             AND procedure.proname IN (
               'authenticate_google_identity',
               'manager_change_employee_access_email',
               'manager_list_employee_access_states'
             )
           ORDER BY procedure.proname`,
          { transaction, type: QueryTypes.SELECT },
        );
        const indexes = await migrationDatabase.query<{ definition: string }>(
          `SELECT indexdef AS definition
           FROM pg_indexes
           WHERE schemaname = 'metas'
             AND indexname = 'auth_identities_active_user_provider_unique_idx'`,
          { transaction, type: QueryTypes.SELECT },
        );
        const constraints = await migrationDatabase.query<{ count: string }>(
          `SELECT count(*)::TEXT AS count
           FROM pg_constraint
           WHERE conname = 'auth_identities_user_provider_unique'`,
          { transaction, type: QueryTypes.SELECT },
        );
        return { constraints, functions, indexes };
      });

      assert.equal(result.functions.length, 3);
      for (const functionSecurity of result.functions) {
        assert.deepEqual(
          {
            fixedSearchPath: functionSecurity.fixedSearchPath,
            owner: functionSecurity.owner,
            publicExecute: functionSecurity.publicExecute,
            runtimeExecute: functionSecurity.runtimeExecute,
            securityDefiner: functionSecurity.securityDefiner,
          },
          {
            fixedSearchPath: true,
            owner: 'metas_migration_owner',
            publicExecute: false,
            runtimeExecute: true,
            securityDefiner: true,
          },
        );
      }
      assert.equal(result.constraints[0]?.count, '0');
      assert.match(result.indexes[0]?.definition ?? '', /UNIQUE/u);
      assert.match(result.indexes[0]?.definition ?? '', /disabled_at IS NULL/u);
    });
  } finally {
    await Promise.all([migrationDatabase.close(), runtimeDatabase.close()]);
  }
}
