import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import { disconnectDatabase } from '../src/config/database.js';
import {
  assertMigrationConnectionSecurity,
  assertPlatformAdminOperatorConnectionSecurity,
  assertRuntimeConnectionSecurity,
} from '../src/database/connectionSecurity.js';
import { hasFirstEnrollmentRequestUniqueIndex } from '../src/database/admin/inspectFirstEnrollmentRequestIndex.js';
import { createMigrator } from '../src/database/umzug.js';
import { withDatabaseContext } from '../src/shared/database/withDatabaseContext.js';
import { createIntegrationDatabases } from './integrationDatabase.js';

interface IdentityFixture {
  employeeId: string;
  storeId: string;
  userId: string;
}

interface AuthenticationFixture {
  authIdentityId: string;
  sessionId: string;
}

const withMigrationOwner = async <Result>(
  database: Sequelize,
  callback: (transaction: Transaction) => Promise<Result>,
): Promise<Result> =>
  database.transaction(async (transaction) => {
    await database.query('SET LOCAL ROLE metas_migration_owner', { transaction });
    return callback(transaction);
  });

const createStoreAndUser = async (
  database: Sequelize,
  label: string,
): Promise<{ storeId: string; userId: string }> => {
  const storeId = randomUUID();
  const userId = randomUUID();
  await withMigrationOwner(database, async (transaction) => {
    await database.query(
      `INSERT INTO metas.stores (id, name, slug)
       VALUES (:storeId, :name, :slug)`,
      {
        replacements: {
          storeId,
          name: `Store ${label}`,
          slug: `${label}-${storeId}`,
        },
        transaction,
      },
    );
    await database.query(
      `INSERT INTO metas.users (id, full_name, primary_email, account_status)
       VALUES (:userId, :name, :email, 'ACTIVE')`,
      {
        replacements: {
          userId,
          name: `User ${label}`,
          email: `${label}-${userId}@example.test`,
        },
        transaction,
      },
    );
  });
  return { storeId, userId };
};

const bootstrapManager = async (
  database: Sequelize,
  storeId: string,
  userId: string,
): Promise<string> =>
  withMigrationOwner(database, async (transaction) => {
    const rows = await database.query<{ employeeId: string }>(
      `SELECT metas.bootstrap_first_manager(
        :storeId,
        :userId,
        CURRENT_DATE
      ) AS "employeeId"`,
      {
        replacements: { storeId, userId },
        transaction,
        type: QueryTypes.SELECT,
      },
    );
    const employeeId = rows[0]?.employeeId;
    assert.ok(employeeId);
    return employeeId;
  });

const createManagerFixture = async (
  database: Sequelize,
  label: string,
): Promise<IdentityFixture> => {
  const { storeId, userId } = await createStoreAndUser(database, label);
  const employeeId = await bootstrapManager(database, storeId, userId);
  return { employeeId, storeId, userId };
};

const createAuthenticationFixture = async (
  database: Sequelize,
  identity: IdentityFixture,
  label: string,
): Promise<AuthenticationFixture> =>
  withMigrationOwner(database, async (transaction) => {
    const authIdentityId = randomUUID();
    const sessionId = randomUUID();
    await database.query(
      `INSERT INTO metas.auth_identities (
        id, user_id, provider, provider_subject, provider_email, provider_verified_at
      ) VALUES (
        :authIdentityId, :userId, 'GOOGLE', :providerSubject, :providerEmail, now()
      )`,
      {
        replacements: {
          authIdentityId,
          userId: identity.userId,
          providerSubject: `google-${label}-${identity.userId}`,
          providerEmail: `${label}-${identity.userId}@example.test`,
        },
        transaction,
      },
    );
    await database.query(
      `INSERT INTO metas.sessions (
        id, user_id, employee_id, auth_identity_id, token_hash, expires_at
      ) VALUES (
        :sessionId, :userId, :employeeId, :authIdentityId, :tokenHash,
        now() + interval '1 hour'
      )`,
      {
        replacements: { authIdentityId, sessionId, tokenHash: randomBytes(32), ...identity },
        transaction,
      },
    );
    return { authIdentityId, sessionId };
  });

const createAdditionalUser = async (database: Sequelize, label: string): Promise<string> => {
  const userId = randomUUID();
  await withMigrationOwner(database, async (transaction) => {
    await database.query(
      `INSERT INTO metas.users (id, full_name, primary_email, account_status)
       VALUES (:userId, :name, :email, 'ACTIVE')`,
      {
        replacements: {
          userId,
          name: `User ${label}`,
          email: `${label}-${userId}@example.test`,
        },
        transaction,
      },
    );
  });
  return userId;
};

const createEmployee = async (
  database: Sequelize,
  storeId: string,
  userId: string,
  createdByUserId: string,
  role: 'BALCONISTA' | 'GESTOR' = 'BALCONISTA',
): Promise<string> =>
  withMigrationOwner(database, async (transaction) => {
    const employeeId = randomUUID();
    await database.query(
      `INSERT INTO metas.employees (
        id, store_id, user_id, role, status, joined_on, created_by_user_id, creation_source
      ) VALUES (
        :employeeId, :storeId, :userId, :role, 'ATIVO', CURRENT_DATE,
        :createdByUserId, 'MANAGER'
      )`,
      {
        replacements: { employeeId, storeId, userId, role, createdByUserId },
        transaction,
      },
    );
    return employeeId;
  });

const testDatabases = createIntegrationDatabases(5, 2);

const inspectReplacementFirstEnrollmentRequestIndex = async (
  database: Sequelize,
  replacementDdl?: string,
): Promise<boolean> => {
  const transaction = await database.transaction();
  try {
    await database.query('SET LOCAL ROLE metas_migration_owner', { transaction });
    await database.query(
      'DROP INDEX metas.platform_admin_webauthn_challenges_first_enrollment_request_uni',
      { transaction },
    );
    if (replacementDdl) {
      await database.query(replacementDdl, { transaction });
    }
    return await hasFirstEnrollmentRequestUniqueIndex(database, transaction);
  } finally {
    await transaction.rollback();
  }
};

if (testDatabases === null) {
  await test('PostgreSQL integration tests require dedicated test URLs', {
    skip: 'TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are not configured.',
  });
} else {
  const { migrationDatabase, platformAdminOperatorDatabase, runtimeDatabase } = testDatabases;

  try {
    await migrationDatabase.authenticate();
    await platformAdminOperatorDatabase.authenticate();
    await runtimeDatabase.authenticate();
    await assertMigrationConnectionSecurity(migrationDatabase);
    await assertPlatformAdminOperatorConnectionSecurity(platformAdminOperatorDatabase);
    await assertRuntimeConnectionSecurity(runtimeDatabase);
    await createMigrator(migrationDatabase).up();

    await test('migrations are fully applied', async () => {
      const pending = await createMigrator(migrationDatabase).pending();
      assert.equal(pending.length, 0);
    });

    await test('inspector accepts the structurally correct truncated first-enrollment index', async () => {
      const indexes = await migrationDatabase.query<{ name: string }>(
        `SELECT index_relation.relname::TEXT AS name
         FROM pg_catalog.pg_index index_metadata
         JOIN pg_catalog.pg_class table_relation
           ON table_relation.oid = index_metadata.indrelid
         JOIN pg_catalog.pg_namespace table_namespace
           ON table_namespace.oid = table_relation.relnamespace
         JOIN pg_catalog.pg_class index_relation
           ON index_relation.oid = index_metadata.indexrelid
         WHERE table_namespace.nspname = 'metas'
           AND table_relation.relname = 'platform_admin_webauthn_challenges'
           AND index_metadata.indisunique = TRUE
           AND index_metadata.indpred IS NOT NULL`,
        { type: QueryTypes.SELECT },
      );
      const actualName = indexes.find(({ name }) =>
        name.startsWith('platform_admin_webauthn_challenges_first_enrollment_request_'),
      )?.name;

      assert.equal(actualName, 'platform_admin_webauthn_challenges_first_enrollment_request_uni');
      assert.equal(Buffer.byteLength(actualName), 63);
      assert.equal(await hasFirstEnrollmentRequestUniqueIndex(migrationDatabase), true);
    });

    await test('inspector rejects a first-enrollment unique index on the wrong column', async () => {
      assert.equal(
        await inspectReplacementFirstEnrollmentRequestIndex(
          migrationDatabase,
          `CREATE UNIQUE INDEX first_enrollment_wrong_column_test_idx
           ON metas.platform_admin_webauthn_challenges (id)
           WHERE first_enrollment_request_id IS NOT NULL`,
        ),
        false,
      );
    });

    await test('inspector rejects a non-unique first-enrollment index', async () => {
      assert.equal(
        await inspectReplacementFirstEnrollmentRequestIndex(
          migrationDatabase,
          `CREATE INDEX first_enrollment_non_unique_test_idx
           ON metas.platform_admin_webauthn_challenges (first_enrollment_request_id)
           WHERE first_enrollment_request_id IS NOT NULL`,
        ),
        false,
      );
    });

    await test('inspector rejects a first-enrollment index with the wrong predicate', async () => {
      assert.equal(
        await inspectReplacementFirstEnrollmentRequestIndex(
          migrationDatabase,
          `CREATE UNIQUE INDEX first_enrollment_wrong_predicate_test_idx
           ON metas.platform_admin_webauthn_challenges (first_enrollment_request_id)
           WHERE first_enrollment_request_id IS NULL`,
        ),
        false,
      );
    });

    await test('inspector rejects a missing first-enrollment index', async () => {
      assert.equal(await inspectReplacementFirstEnrollmentRequestIndex(migrationDatabase), false);
    });

    await test('database constraints reject duplicate email and employee membership', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'constraints');

      await assert.rejects(
        withMigrationOwner(migrationDatabase, async (transaction) => {
          await migrationDatabase.query(
            `INSERT INTO metas.users (full_name, primary_email, account_status)
             SELECT 'Duplicate', upper(primary_email::TEXT), 'ACTIVE'
             FROM metas.users WHERE id = :userId`,
            { replacements: { userId: manager.userId }, transaction },
          );
        }),
      );

      await assert.rejects(
        createEmployee(migrationDatabase, manager.storeId, manager.userId, manager.userId),
      );
    });

    await test('session cannot combine a user with another user employee', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'session-owner');
      const otherUserId = await createAdditionalUser(migrationDatabase, 'session-other');

      await assert.rejects(
        withMigrationOwner(migrationDatabase, async (transaction) => {
          await migrationDatabase.query(
            `INSERT INTO metas.sessions (user_id, employee_id, expires_at)
             VALUES (:userId, :employeeId, now() + interval '1 hour')`,
            {
              replacements: { userId: otherUserId, employeeId: manager.employeeId },
              transaction,
            },
          );
        }),
      );

      const otherIdentityId = randomUUID();
      await withMigrationOwner(migrationDatabase, async (transaction) => {
        await migrationDatabase.query(
          `INSERT INTO metas.auth_identities (
            id, user_id, provider, provider_subject, provider_email
          ) VALUES (
            :identityId, :userId, 'GOOGLE', :providerSubject, :providerEmail
          )`,
          {
            replacements: {
              identityId: otherIdentityId,
              userId: otherUserId,
              providerSubject: `google-${otherUserId}`,
              providerEmail: `google-${otherUserId}@example.test`,
            },
            transaction,
          },
        );
      });
      await assert.rejects(
        withMigrationOwner(migrationDatabase, async (transaction) => {
          await migrationDatabase.query(
            `INSERT INTO metas.sessions (
              user_id, employee_id, auth_identity_id, expires_at
            ) VALUES (
              :userId, :employeeId, :identityId, now() + interval '1 hour'
            )`,
            {
              replacements: {
                userId: manager.userId,
                employeeId: manager.employeeId,
                identityId: otherIdentityId,
              },
              transaction,
            },
          );
        }),
      );
    });

    await test('only the first manager bootstrap is accepted', async () => {
      const { storeId, userId } = await createStoreAndUser(migrationDatabase, 'bootstrap-once');
      const secondUserId = await createAdditionalUser(migrationDatabase, 'bootstrap-twice');

      await bootstrapManager(migrationDatabase, storeId, userId);
      await assert.rejects(bootstrapManager(migrationDatabase, storeId, secondUserId));
    });

    await test('last active manager cannot be disabled, but one of two can', async () => {
      const manager = await createManagerFixture(migrationDatabase, 'last-manager');

      await assert.rejects(
        withMigrationOwner(migrationDatabase, async (transaction) => {
          await migrationDatabase.query(
            `UPDATE metas.employees SET status = 'INATIVO' WHERE id = :employeeId`,
            { replacements: { employeeId: manager.employeeId }, transaction },
          );
        }),
      );

      const secondUserId = await createAdditionalUser(migrationDatabase, 'second-manager');
      await createEmployee(
        migrationDatabase,
        manager.storeId,
        secondUserId,
        manager.userId,
        'GESTOR',
      );
      await withMigrationOwner(migrationDatabase, async (transaction) => {
        await migrationDatabase.query(
          `UPDATE metas.employees SET status = 'INATIVO' WHERE id = :employeeId`,
          { replacements: { employeeId: manager.employeeId }, transaction },
        );
      });
    });

    await test('RLS denies missing context and isolates stores', async () => {
      const storeA = await createManagerFixture(migrationDatabase, 'rls-a');
      const storeB = await createManagerFixture(migrationDatabase, 'rls-b');
      const authenticationA = await createAuthenticationFixture(migrationDatabase, storeA, 'rls-a');
      await createAuthenticationFixture(migrationDatabase, storeB, 'rls-b');

      const withoutContext = await Promise.all(
        ['stores', 'users', 'auth_identities', 'employees', 'sessions'].map((tableName) =>
          runtimeDatabase.query<{ id: string }>(`SELECT id FROM metas.${tableName}`, {
            type: QueryTypes.SELECT,
          }),
        ),
      );
      assert.ok(withoutContext.every((rows) => rows.length === 0));

      const visibleA = await withDatabaseContext(runtimeDatabase, storeA, async (transaction) =>
        runtimeDatabase.query<{ storeId: string }>(
          'SELECT store_id AS "storeId" FROM metas.employees ORDER BY id',
          { transaction, type: QueryTypes.SELECT },
        ),
      );
      assert.ok(visibleA.length >= 1);
      assert.deepEqual(new Set(visibleA.map(({ storeId }) => storeId)), new Set([storeA.storeId]));

      const visibleB = await withDatabaseContext(runtimeDatabase, storeB, async (transaction) =>
        runtimeDatabase.query<{ storeId: string }>(
          'SELECT store_id AS "storeId" FROM metas.employees ORDER BY id',
          { transaction, type: QueryTypes.SELECT },
        ),
      );
      assert.deepEqual(new Set(visibleB.map(({ storeId }) => storeId)), new Set([storeB.storeId]));

      const storesVisibleToA = await withDatabaseContext(
        runtimeDatabase,
        storeA,
        async (transaction) =>
          runtimeDatabase.query<{ id: string }>('SELECT id FROM metas.stores', {
            transaction,
            type: QueryTypes.SELECT,
          }),
      );
      assert.deepEqual(
        storesVisibleToA.map(({ id }) => id),
        [storeA.storeId],
      );

      const globalRowsVisibleToA = await withDatabaseContext(
        runtimeDatabase,
        storeA,
        async (transaction) => {
          const users = await runtimeDatabase.query<{ id: string }>('SELECT id FROM metas.users', {
            transaction,
            type: QueryTypes.SELECT,
          });
          const identities = await runtimeDatabase.query<{
            id: string;
            providerSubject: string;
          }>(
            `SELECT id, provider_subject AS "providerSubject"
             FROM metas.auth_identities`,
            { transaction, type: QueryTypes.SELECT },
          );
          const sessions = await runtimeDatabase.query<{ id: string }>(
            'SELECT id FROM metas.sessions',
            {
              transaction,
              type: QueryTypes.SELECT,
            },
          );
          return { identities, sessions, users };
        },
      );
      assert.deepEqual(
        globalRowsVisibleToA.users.map(({ id }) => id),
        [storeA.userId],
      );
      assert.deepEqual(
        globalRowsVisibleToA.identities.map(({ id }) => id),
        [authenticationA.authIdentityId],
      );
      assert.ok(
        globalRowsVisibleToA.identities.every(({ providerSubject }) =>
          providerSubject.includes(storeA.userId),
        ),
      );
      assert.deepEqual(
        globalRowsVisibleToA.sessions.map(({ id }) => id),
        [authenticationA.sessionId],
      );
    });

    await test('transaction-local RLS context does not leak through the pool', async () => {
      const storeA = await createManagerFixture(migrationDatabase, 'pool-context-a');
      const storeB = await createManagerFixture(migrationDatabase, 'pool-context-b');
      const visible = await withDatabaseContext(runtimeDatabase, storeA, async (transaction) =>
        runtimeDatabase.query<{ id: string }>('SELECT id FROM metas.employees', {
          transaction,
          type: QueryTypes.SELECT,
        }),
      );
      assert.ok(visible.length >= 1);

      const afterTransaction = await runtimeDatabase.query<{ id: string }>(
        'SELECT id FROM metas.employees',
        { type: QueryTypes.SELECT },
      );
      assert.equal(afterTransaction.length, 0);

      await assert.rejects(
        withDatabaseContext(runtimeDatabase, storeA, async (transaction) => {
          const duringRollback = await runtimeDatabase.query<{ storeId: string }>(
            'SELECT store_id AS "storeId" FROM metas.employees',
            { transaction, type: QueryTypes.SELECT },
          );
          assert.ok(duringRollback.every(({ storeId }) => storeId === storeA.storeId));
          throw new Error('force rollback');
        }),
      );

      const afterRollback = await runtimeDatabase.query<{ id: string }>(
        'SELECT id FROM metas.employees',
        { type: QueryTypes.SELECT },
      );
      assert.equal(afterRollback.length, 0);

      const visibleB = await withDatabaseContext(runtimeDatabase, storeB, async (transaction) =>
        runtimeDatabase.query<{ storeId: string }>(
          'SELECT store_id AS "storeId" FROM metas.employees',
          { transaction, type: QueryTypes.SELECT },
        ),
      );
      assert.ok(visibleB.every(({ storeId }) => storeId === storeB.storeId));
    });

    await test('runtime role has no DDL, ownership, superuser or BYPASSRLS', async () => {
      await assert.rejects(
        migrationDatabase.query('CREATE TABLE metas.migration_without_set_role (id INTEGER)'),
      );
      await assert.rejects(
        runtimeDatabase.query('CREATE TABLE metas.runtime_forbidden (id INTEGER)'),
      );
      await assert.rejects(
        runtimeDatabase.query('CREATE TABLE public.runtime_forbidden (id INTEGER)'),
      );
      await assert.rejects(
        platformAdminOperatorDatabase.query('CREATE TABLE metas.operator_forbidden (id INTEGER)'),
      );
      await assert.rejects(platformAdminOperatorDatabase.query('CREATE ROLE operator_forbidden'));
      await assert.rejects(
        platformAdminOperatorDatabase.query('SELECT * FROM metas.platform_admins'),
      );
      await assert.rejects(
        platformAdminOperatorDatabase.query(
          `UPDATE metas.platform_admin_first_enrollment_requests SET status = 'REVOKED'`,
        ),
      );
      await assert.rejects(
        platformAdminOperatorDatabase.query(
          `INSERT INTO metas.platform_admin_first_enrollment_requests DEFAULT VALUES`,
        ),
      );
      await assert.rejects(
        platformAdminOperatorDatabase.query(
          `DELETE FROM metas.platform_admin_first_enrollment_requests`,
        ),
      );
      await assert.rejects(
        runtimeDatabase.query('ALTER TABLE metas.stores ADD COLUMN forbidden INTEGER'),
      );
      await assert.rejects(runtimeDatabase.query('DROP TABLE metas.stores'));
      await assert.rejects(runtimeDatabase.query('CREATE ROLE runtime_forbidden'));
      await assert.rejects(
        runtimeDatabase.query(
          `INSERT INTO metas.stores (id, name, slug)
           VALUES (:id, 'Forbidden', :slug)`,
          { replacements: { id: randomUUID(), slug: `forbidden-${randomUUID()}` } },
        ),
      );
      await assert.rejects(
        runtimeDatabase.query("UPDATE metas.stores SET name = 'Forbidden update'"),
      );
      await assert.rejects(runtimeDatabase.query('DELETE FROM metas.stores'));

      const roles = await migrationDatabase.query<{
        rolbypassrls: boolean;
        rolcanlogin: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolreplication: boolean;
        rolname: string;
        rolsuper: boolean;
      }>(
        `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin,
                rolreplication, rolbypassrls
         FROM pg_roles
         WHERE rolname IN (
           'metas_migration_owner',
           'metas_migration_runner',
           'metas_app_runtime',
           'metas_platform_admin_operator',
           'metas_platform_admin_runtime'
         )
         ORDER BY rolname`,
        { type: QueryTypes.SELECT },
      );
      assert.equal(roles.length, 5);
      for (const role of roles) {
        assert.equal(role.rolsuper, false);
        assert.equal(role.rolcreatedb, false);
        assert.equal(role.rolcreaterole, false);
        assert.equal(role.rolreplication, false);
        assert.equal(role.rolbypassrls, false);
        assert.equal(role.rolcanlogin, role.rolname !== 'metas_migration_owner');
      }

      const memberships = await migrationDatabase.query<{
        runnerCanAssumeOwner: boolean;
        operatorCanAssumeAppRuntime: boolean;
        operatorCanAssumeMigrationOwner: boolean;
        operatorCanAssumeMigrationRunner: boolean;
        operatorCanAssumePlatformAdminRuntime: boolean;
        runtimeCanAssumeOwner: boolean;
        runtimeCanAssumeRunner: boolean;
      }>(
        `SELECT
          pg_has_role(
            'metas_migration_runner', 'metas_migration_owner', 'MEMBER'
          ) AS "runnerCanAssumeOwner",
          pg_has_role(
            'metas_app_runtime', 'metas_migration_owner', 'MEMBER'
          ) AS "runtimeCanAssumeOwner",
          pg_has_role(
            'metas_app_runtime', 'metas_migration_runner', 'MEMBER'
          ) AS "runtimeCanAssumeRunner",
          pg_has_role(
            'metas_platform_admin_operator', 'metas_migration_owner', 'MEMBER'
          ) AS "operatorCanAssumeMigrationOwner",
          pg_has_role(
            'metas_platform_admin_operator', 'metas_migration_runner', 'MEMBER'
          ) AS "operatorCanAssumeMigrationRunner",
          pg_has_role(
            'metas_platform_admin_operator', 'metas_app_runtime', 'MEMBER'
          ) AS "operatorCanAssumeAppRuntime",
          pg_has_role(
            'metas_platform_admin_operator', 'metas_platform_admin_runtime', 'MEMBER'
          ) AS "operatorCanAssumePlatformAdminRuntime"`,
        { type: QueryTypes.SELECT },
      );
      assert.deepEqual(memberships[0], {
        runnerCanAssumeOwner: true,
        operatorCanAssumeAppRuntime: false,
        operatorCanAssumeMigrationOwner: false,
        operatorCanAssumeMigrationRunner: false,
        operatorCanAssumePlatformAdminRuntime: false,
        runtimeCanAssumeOwner: false,
        runtimeCanAssumeRunner: false,
      });

      const privileges = await runtimeDatabase.query<{
        canDelete: boolean;
        canInsert: boolean;
        canSelect: boolean;
        canUpdate: boolean;
      }>(
        `SELECT
          has_table_privilege(current_user, 'metas.employees', 'SELECT') AS "canSelect",
          has_table_privilege(current_user, 'metas.employees', 'INSERT') AS "canInsert",
          has_table_privilege(current_user, 'metas.employees', 'UPDATE') AS "canUpdate",
          has_table_privilege(current_user, 'metas.employees', 'DELETE') AS "canDelete"`,
        { type: QueryTypes.SELECT },
      );
      assert.deepEqual(privileges[0], {
        canSelect: true,
        canInsert: false,
        canUpdate: false,
        canDelete: false,
      });

      const owners = await migrationDatabase.query<{ owner: string }>(
        `SELECT DISTINCT owner.rolname AS owner
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         JOIN pg_roles owner ON owner.oid = relation.relowner
         WHERE namespace.nspname = 'metas' AND relation.relkind = 'r'`,
        { type: QueryTypes.SELECT },
      );
      assert.ok(owners.length > 0);
      assert.ok(owners.every(({ owner }) => owner === 'metas_migration_owner'));

      const schemaSecurity = await migrationDatabase.query<{
        owner: string;
        publicCanCreate: boolean;
        runtimeCanCreate: boolean;
        runtimeCanUse: boolean;
      }>(
        `SELECT
          owner.rolname AS owner,
          has_schema_privilege('public', 'metas', 'CREATE') AS "publicCanCreate",
          has_schema_privilege('metas_app_runtime', 'metas', 'CREATE') AS "runtimeCanCreate",
          has_schema_privilege('metas_app_runtime', 'metas', 'USAGE') AS "runtimeCanUse"
         FROM pg_namespace namespace
         JOIN pg_roles owner ON owner.oid = namespace.nspowner
         WHERE namespace.nspname = 'metas'`,
        { type: QueryTypes.SELECT },
      );
      assert.deepEqual(schemaSecurity[0], {
        owner: 'metas_migration_owner',
        publicCanCreate: false,
        runtimeCanCreate: false,
        runtimeCanUse: true,
      });

      const infrastructure = await migrationDatabase.query<{
        extensionCount: string;
        generatedUuid: string;
        publicCanBootstrap: boolean;
      }>(
        `SELECT
          (SELECT count(*)::TEXT FROM pg_extension WHERE extname IN ('citext', 'btree_gist'))
            AS "extensionCount",
          gen_random_uuid()::TEXT AS "generatedUuid",
          has_function_privilege(
            'public', 'metas.bootstrap_first_manager(uuid,uuid,date)', 'EXECUTE'
          ) AS "publicCanBootstrap"`,
        { type: QueryTypes.SELECT },
      );
      assert.equal(infrastructure[0]?.extensionCount, '2');
      assert.match(infrastructure[0]?.generatedUuid ?? '', /^[0-9a-f-]{36}$/u);
      assert.equal(infrastructure[0]?.publicCanBootstrap, false);

      const rlsTables = await migrationDatabase.query<{
        forceRowSecurity: boolean;
        rowSecurity: boolean;
        tableName: string;
      }>(
        `SELECT
          relation.relname AS "tableName",
          relation.relrowsecurity AS "rowSecurity",
          relation.relforcerowsecurity AS "forceRowSecurity"
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'metas'
           AND relation.relname IN ('stores', 'users', 'auth_identities', 'employees', 'sessions')`,
        { type: QueryTypes.SELECT },
      );
      assert.equal(rlsTables.length, 5);
      assert.ok(
        rlsTables.every(({ rowSecurity, forceRowSecurity }) => rowSecurity && forceRowSecurity),
      );
    });

    await test('concurrent bootstrap allows exactly one first manager', async () => {
      const { storeId, userId } = await createStoreAndUser(
        migrationDatabase,
        'concurrent-bootstrap',
      );
      const secondUserId = await createAdditionalUser(migrationDatabase, 'concurrent-bootstrap-2');
      const attempts = await Promise.allSettled([
        bootstrapManager(migrationDatabase, storeId, userId),
        bootstrapManager(migrationDatabase, storeId, secondUserId),
      ]);

      assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
      assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);
    });

    await test('concurrent manager changes preserve one active manager', async () => {
      const first = await createManagerFixture(migrationDatabase, 'concurrent-manager');
      const secondUserId = await createAdditionalUser(migrationDatabase, 'concurrent-manager-2');
      const secondEmployeeId = await createEmployee(
        migrationDatabase,
        first.storeId,
        secondUserId,
        first.userId,
        'GESTOR',
      );

      const disable = async (employeeId: string): Promise<void> =>
        withMigrationOwner(migrationDatabase, async (transaction) => {
          await migrationDatabase.query(
            `UPDATE metas.employees SET status = 'INATIVO' WHERE id = :employeeId`,
            { replacements: { employeeId }, transaction },
          );
        });
      const attempts = await Promise.allSettled([
        disable(first.employeeId),
        disable(secondEmployeeId),
      ]);
      assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
      assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);

      const rows = await withMigrationOwner(migrationDatabase, async (transaction) =>
        migrationDatabase.query<{ count: string }>(
          `SELECT count(*)::TEXT AS count
           FROM metas.employees
           WHERE store_id = :storeId AND role = 'GESTOR' AND status = 'ATIVO'`,
          {
            replacements: { storeId: first.storeId },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      assert.equal(rows[0]?.count, '1');
    });
  } finally {
    await Promise.all([
      disconnectDatabase(platformAdminOperatorDatabase),
      disconnectDatabase(runtimeDatabase),
      disconnectDatabase(migrationDatabase),
    ]);
  }
}
