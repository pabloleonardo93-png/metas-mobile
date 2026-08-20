import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { disconnectDatabase } from '../src/config/database.js';
import { createMigrator } from '../src/database/umzug.js';
import { PostgresAuthenticationService } from '../src/modules/auth/authenticationService.js';
import type {
  GoogleIdTokenVerifier,
  LoginResult,
  MeResult,
  UserRole,
  VerifiedGoogleIdentity,
} from '../src/modules/auth/auth.types.js';
import { hashSessionToken } from '../src/modules/auth/sessionToken.js';
import { PostgresEmployeeService } from '../src/modules/employees/employeeService.js';
import type { EmployeeDto } from '../src/modules/employees/employee.types.js';
import type { Logger } from '../src/shared/logging/logger.js';
import { createIntegrationDatabases } from './integrationDatabase.js';

interface EmployeeFixture {
  employeeId: string;
  email: string;
  managerUserId: string;
  storeId: string;
  userId: string;
}

class FakeGoogleVerifier implements GoogleIdTokenVerifier {
  public constructor(public identity: VerifiedGoogleIdentity) {}

  public verify(): Promise<VerifiedGoogleIdentity> {
    return Promise.resolve(this.identity);
  }
}

const silentLogger: Logger = {
  error: () => undefined,
  info: () => undefined,
};

const parseJson = <Result extends object>(text: string): Result => {
  const value: unknown = JSON.parse(text);
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  return value as Result;
};

const withMigrationOwner = async <Result>(
  database: Sequelize,
  callback: (transaction: Transaction) => Promise<Result>,
): Promise<Result> =>
  database.transaction(async (transaction) => {
    await database.query('SET LOCAL ROLE metas_migration_owner', { transaction });
    return callback(transaction);
  });

const createStoreWithManager = async (
  database: Sequelize,
  label: string,
): Promise<{ managerEmail: string; managerUserId: string; storeId: string }> => {
  const storeId = randomUUID();
  const managerUserId = randomUUID();
  const managerEmail = `manager-${label}-${managerUserId}@example.test`;
  await withMigrationOwner(database, async (transaction) => {
    await database.query(
      `INSERT INTO metas.stores (id, name, slug)
       VALUES (:storeId, :name, :slug)`,
      {
        replacements: { name: `Auth Store ${label}`, slug: `${label}-${storeId}`, storeId },
        transaction,
      },
    );
    await database.query(
      `INSERT INTO metas.users (id, full_name, primary_email, account_status)
       VALUES (:userId, :name, :email, 'ACTIVE')`,
      {
        replacements: {
          email: managerEmail,
          name: `Manager ${label}`,
          userId: managerUserId,
        },
        transaction,
      },
    );
    await database.query('SELECT metas.bootstrap_first_manager(:storeId, :userId, CURRENT_DATE)', {
      replacements: { storeId, userId: managerUserId },
      transaction,
    });
  });
  return { managerEmail, managerUserId, storeId };
};

const createEmployeeFixture = async (
  database: Sequelize,
  label: string,
  options: {
    accountStatus?: 'ACTIVE' | 'DISABLED' | 'PENDING';
    employeeStatus?: 'ATIVO' | 'INATIVO';
    role?: UserRole;
  } = {},
): Promise<EmployeeFixture> => {
  const { managerUserId, storeId } = await createStoreWithManager(database, label);
  const userId = randomUUID();
  const employeeId = randomUUID();
  const email = `${label}-${userId}@example.test`;
  await withMigrationOwner(database, async (transaction) => {
    await database.query(
      `INSERT INTO metas.users (id, full_name, primary_email, account_status)
       VALUES (:userId, :name, :email, :accountStatus)`,
      {
        replacements: {
          accountStatus: options.accountStatus ?? 'PENDING',
          email,
          name: `Employee ${label}`,
          userId,
        },
        transaction,
      },
    );
    await database.query(
      `INSERT INTO metas.employees (
        id, store_id, user_id, role, status, joined_on, created_by_user_id, creation_source
      ) VALUES (
        :employeeId, :storeId, :userId, :role, 'ATIVO', CURRENT_DATE,
        :managerUserId, 'MANAGER'
      )`,
      {
        replacements: {
          employeeId,
          managerUserId,
          role: options.role ?? 'BALCONISTA',
          storeId,
          userId,
        },
        transaction,
      },
    );
    if (options.employeeStatus === 'INATIVO') {
      await database.query(
        `UPDATE metas.employees
         SET status = 'INATIVO', ended_on = CURRENT_DATE
         WHERE id = :employeeId`,
        { replacements: { employeeId }, transaction },
      );
    }
  });
  return { email, employeeId, managerUserId, storeId, userId };
};

const createTestApp = (database: Sequelize, verifier: GoogleIdTokenVerifier, ttlSeconds = 3600) =>
  createApp({
    authenticationService: new PostgresAuthenticationService(database, verifier, ttlSeconds),
    logger: silentLogger,
  });

const testDatabases = createIntegrationDatabases(5, 3);

if (testDatabases === null) {
  await test('authentication integration tests require dedicated test URLs', {
    skip: 'TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are not configured.',
  });
} else {
  const { migrationDatabase, runtimeDatabase } = testDatabases;

  try {
    await migrationDatabase.authenticate();
    await runtimeDatabase.authenticate();
    await createMigrator(migrationDatabase).up();

    await test('first Google login links a pre-registered user, activates PENDING and hashes session', async () => {
      const fixture = await createEmployeeFixture(migrationDatabase, 'first-login');
      const verifier = new FakeGoogleVerifier({
        email: fixture.email,
        subject: `subject-${randomUUID()}`,
      });
      const response = await request(createTestApp(runtimeDatabase, verifier))
        .post('/v1/auth/google')
        .send({ idToken: 'valid-first-login-token' })
        .expect(200);
      const body = parseJson<LoginResult>(response.text);

      assert.equal(body.user.id, fixture.userId);
      assert.equal(body.user.role, 'BALCONISTA');
      assert.match(body.sessionToken, /^[A-Za-z0-9_-]{43}$/u);

      const stored = await withMigrationOwner(migrationDatabase, async (transaction) => {
        const users = await migrationDatabase.query<{
          accountStatus: string;
          emailVerified: boolean;
        }>(
          `SELECT account_status AS "accountStatus",
                  email_verified_at IS NOT NULL AS "emailVerified"
           FROM metas.users WHERE id = :userId`,
          { replacements: { userId: fixture.userId }, transaction, type: QueryTypes.SELECT },
        );
        const identities = await migrationDatabase.query<{ count: string }>(
          `SELECT count(*)::TEXT AS count
           FROM metas.auth_identities WHERE user_id = :userId AND provider = 'GOOGLE'`,
          { replacements: { userId: fixture.userId }, transaction, type: QueryTypes.SELECT },
        );
        const sessions = await migrationDatabase.query<{ tokenHash: Buffer }>(
          `SELECT token_hash AS "tokenHash"
           FROM metas.sessions WHERE user_id = :userId ORDER BY created_at DESC LIMIT 1`,
          { replacements: { userId: fixture.userId }, transaction, type: QueryTypes.SELECT },
        );
        return { identities, sessions, users };
      });
      assert.deepEqual(stored.users[0], { accountStatus: 'ACTIVE', emailVerified: true });
      assert.equal(stored.identities[0]?.count, '1');
      assert.deepEqual(stored.sessions[0]?.tokenHash, hashSessionToken(body.sessionToken));
      assert.notEqual(stored.sessions[0]?.tokenHash.toString('utf8'), body.sessionToken);
    });

    await test('manager-created employees of every active role can log in from an independent client', async () => {
      const roles: readonly UserRole[] = ['GESTOR', 'BALCONISTA', 'CAIXA', 'FARMACEUTICO'];

      for (const role of roles) {
        const label = `cross-client-${role.toLowerCase()}`;
        const manager = await createStoreWithManager(migrationDatabase, label);
        const managerAuthentication = new PostgresAuthenticationService(
          runtimeDatabase,
          new FakeGoogleVerifier({
            email: manager.managerEmail,
            subject: `manager-subject-${randomUUID()}`,
          }),
          3600,
        );
        const managerApp = createApp({
          authenticationService: managerAuthentication,
          employeeService: new PostgresEmployeeService(runtimeDatabase),
          logger: silentLogger,
        });
        const managerLogin = await request(managerApp)
          .post('/v1/auth/google')
          .send({ idToken: `valid-manager-token-${role.toLowerCase()}` })
          .expect(200);
        const managerAuthorization = `Bearer ${parseJson<LoginResult>(managerLogin.text).sessionToken}`;
        const employeeEmail = `created-${role.toLowerCase()}-${randomUUID()}@example.test`;
        const created = await request(managerApp)
          .post('/v1/manager/employees')
          .set('Authorization', managerAuthorization)
          .send({
            email: `  ${employeeEmail.toUpperCase()}  `,
            joinedOn: new Date().toISOString().slice(0, 10),
            name: `Cross Client ${role}`,
            role,
            status: 'ATIVO',
          })
          .expect(201);
        const createdBody = parseJson<{ email: string; id: string; role: UserRole }>(created.text);
        assert.equal(createdBody.email, employeeEmail);
        assert.equal(createdBody.role, role);

        const independentApp = createTestApp(
          runtimeDatabase,
          new FakeGoogleVerifier({
            email: employeeEmail,
            subject: `employee-subject-${randomUUID()}`,
          }),
        );
        const employeeLogin = await request(independentApp)
          .post('/v1/auth/google')
          .send({ idToken: `valid-independent-token-${role.toLowerCase()}` })
          .expect(200);
        const employeeLoginBody = parseJson<LoginResult>(employeeLogin.text);
        assert.equal(employeeLoginBody.user.role, role);

        const persisted = await withMigrationOwner(migrationDatabase, async (transaction) =>
          migrationDatabase.query<{
            accountStatus: string;
            activeEmployee: boolean;
            correctStore: boolean;
            identities: string;
            sessions: string;
          }>(
            `SELECT
              app_user.account_status AS "accountStatus",
              employee.status = 'ATIVO' AS "activeEmployee",
              employee.store_id = :storeId AS "correctStore",
              count(DISTINCT identity.id)::TEXT AS identities,
              count(DISTINCT session.id)::TEXT AS sessions
             FROM metas.users app_user
             JOIN metas.employees employee ON employee.user_id = app_user.id
             LEFT JOIN metas.auth_identities identity ON identity.user_id = app_user.id
             LEFT JOIN metas.sessions session ON session.user_id = app_user.id
             WHERE employee.id = :employeeId
             GROUP BY app_user.id, employee.id`,
            {
              replacements: { employeeId: createdBody.id, storeId: manager.storeId },
              transaction,
              type: QueryTypes.SELECT,
            },
          ),
        );
        assert.deepEqual(persisted[0], {
          accountStatus: 'ACTIVE',
          activeEmployee: true,
          correctStore: true,
          identities: '1',
          sessions: '1',
        });
      }
    });

    await test('an unlinked employee email can be changed before the first Google login', async () => {
      const manager = await createStoreWithManager(migrationDatabase, 'unlinked-email-manager');
      const managerApp = createApp({
        authenticationService: new PostgresAuthenticationService(
          runtimeDatabase,
          new FakeGoogleVerifier({
            email: manager.managerEmail,
            subject: `unlinked-manager-${randomUUID()}`,
          }),
          3600,
        ),
        employeeService: new PostgresEmployeeService(runtimeDatabase),
        logger: silentLogger,
      });
      const managerLogin = await request(managerApp)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-unlinked-manager-token' })
        .expect(200);
      const managerAuthorization = `Bearer ${
        parseJson<LoginResult>(managerLogin.text).sessionToken
      }`;
      const originalEmail = `unlinked-original-${randomUUID()}@example.test`;
      const created = await request(managerApp)
        .post('/v1/manager/employees')
        .set('Authorization', managerAuthorization)
        .send({
          email: originalEmail,
          joinedOn: new Date().toISOString().slice(0, 10),
          name: 'Unlinked Employee',
          role: 'CAIXA',
          status: 'ATIVO',
        })
        .expect(201);
      const employee = parseJson<EmployeeDto>(created.text);
      const newEmail = `unlinked-new-${randomUUID()}@example.test`;
      const updated = await request(managerApp)
        .patch(`/v1/manager/employees/${employee.id}`)
        .set('Authorization', managerAuthorization)
        .send({
          email: `  ${newEmail.toUpperCase()}  `,
          joinedOn: employee.joinedOn,
          name: employee.name,
          role: employee.role,
          status: employee.status,
        })
        .expect(200);
      assert.deepEqual(
        {
          email: parseJson<EmployeeDto>(updated.text).email,
          googleLinked: parseJson<EmployeeDto>(updated.text).googleLinked,
        },
        { email: newEmail, googleLinked: false },
      );

      await request(
        createTestApp(
          runtimeDatabase,
          new FakeGoogleVerifier({
            email: originalEmail,
            subject: `unlinked-old-${randomUUID()}`,
          }),
        ),
      )
        .post('/v1/auth/google')
        .send({ idToken: 'valid-unlinked-old-email-token' })
        .expect(403);
      const login = await request(
        createTestApp(
          runtimeDatabase,
          new FakeGoogleVerifier({
            email: newEmail,
            subject: `unlinked-new-${randomUUID()}`,
          }),
        ),
      )
        .post('/v1/auth/google')
        .send({ idToken: 'valid-unlinked-new-email-token' })
        .expect(200);
      assert.equal(parseJson<LoginResult>(login.text).user.role, 'CAIXA');
    });

    await test('explicit access email change revokes the old Google access and permits the new account', async () => {
      const manager = await createStoreWithManager(migrationDatabase, 'access-email-manager');
      const managerApp = createTestApp(
        runtimeDatabase,
        new FakeGoogleVerifier({
          email: manager.managerEmail,
          subject: `manager-access-email-${randomUUID()}`,
        }),
      );
      const managerLogin = await request(managerApp)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-access-email-manager-token' })
        .expect(200);
      const managerAuthorization = `Bearer ${
        parseJson<LoginResult>(managerLogin.text).sessionToken
      }`;
      const employeeServiceApp = createApp({
        authenticationService: new PostgresAuthenticationService(
          runtimeDatabase,
          new FakeGoogleVerifier({
            email: manager.managerEmail,
            subject: `unused-${randomUUID()}`,
          }),
          3600,
        ),
        employeeService: new PostgresEmployeeService(runtimeDatabase),
        logger: silentLogger,
      });
      const originalEmail = `linked-manager-${randomUUID()}@example.test`;
      const created = await request(employeeServiceApp)
        .post('/v1/manager/employees')
        .set('Authorization', managerAuthorization)
        .send({
          email: originalEmail,
          joinedOn: new Date().toISOString().slice(0, 10),
          name: 'Linked Manager',
          role: 'GESTOR',
          status: 'ATIVO',
        })
        .expect(201);
      const employee = parseJson<EmployeeDto>(created.text);
      assert.equal(employee.googleLinked, false);

      const originalSubject = `linked-subject-${randomUUID()}`;
      const originalVerifier = new FakeGoogleVerifier({
        email: originalEmail,
        subject: originalSubject,
      });
      const originalApp = createTestApp(runtimeDatabase, originalVerifier);
      const originalLogin = await request(originalApp)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-linked-manager-token' })
        .expect(200);
      const originalLoginBody = parseJson<LoginResult>(originalLogin.text);
      const originalAuthorization = `Bearer ${originalLoginBody.sessionToken}`;

      const linkedEmployee = await request(employeeServiceApp)
        .get(`/v1/manager/employees/${employee.id}`)
        .set('Authorization', managerAuthorization)
        .expect(200);
      assert.deepEqual(
        {
          email: parseJson<EmployeeDto>(linkedEmployee.text).email,
          googleLinked: parseJson<EmployeeDto>(linkedEmployee.text).googleLinked,
        },
        { email: originalEmail, googleLinked: true },
      );

      const profileUpdated = await request(employeeServiceApp)
        .patch(`/v1/manager/employees/${employee.id}`)
        .set('Authorization', managerAuthorization)
        .send({
          email: originalEmail,
          joinedOn: employee.joinedOn,
          name: 'Linked Manager Updated',
          role: employee.role,
          status: employee.status,
        })
        .expect(200);
      const profile = parseJson<EmployeeDto>(profileUpdated.text);
      assert.equal(profile.name, 'Linked Manager Updated');
      assert.equal(profile.email, originalEmail);
      assert.equal(profile.googleLinked, true);

      const newEmail = `new-linked-manager-${randomUUID()}@example.test`;
      const silentEdit = await request(employeeServiceApp)
        .patch(`/v1/manager/employees/${employee.id}`)
        .set('Authorization', managerAuthorization)
        .send({
          email: newEmail,
          joinedOn: employee.joinedOn,
          name: profile.name,
          role: employee.role,
          status: employee.status,
        })
        .expect(409);
      assert.equal(
        parseJson<{ code: string }>(silentEdit.text).code,
        'EMPLOYEE_ACCESS_EMAIL_CHANGE_REQUIRES_EXPLICIT_RESET',
      );

      const changed = await request(employeeServiceApp)
        .patch(`/v1/manager/employees/${employee.id}/access-email`)
        .set('Authorization', managerAuthorization)
        .send({ email: `  ${newEmail.toUpperCase()}  ` })
        .expect(200);
      assert.deepEqual(
        {
          email: parseJson<EmployeeDto>(changed.text).email,
          googleLinked: parseJson<EmployeeDto>(changed.text).googleLinked,
        },
        { email: newEmail, googleLinked: false },
      );

      await request(originalApp)
        .get('/v1/me')
        .set('Authorization', originalAuthorization)
        .expect(401);
      await request(originalApp)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-old-account-after-reset-token' })
        .expect(403);

      const replacementLogin = await request(
        createTestApp(
          runtimeDatabase,
          new FakeGoogleVerifier({
            email: newEmail,
            subject: `replacement-subject-${randomUUID()}`,
          }),
        ),
      )
        .post('/v1/auth/google')
        .send({ idToken: 'valid-replacement-account-token' })
        .expect(200);
      assert.equal(parseJson<LoginResult>(replacementLogin.text).user.role, 'GESTOR');

      const stored = await withMigrationOwner(migrationDatabase, async (transaction) => {
        const rows = await migrationDatabase.query<{
          activeIdentities: string;
          disabledIdentities: string;
          oldSessionRevoked: boolean;
          primaryEmail: string;
        }>(
          `SELECT
             app_user.primary_email::TEXT AS "primaryEmail",
             count(DISTINCT identity.id) FILTER (WHERE identity.disabled_at IS NULL)::TEXT
               AS "activeIdentities",
             count(DISTINCT identity.id) FILTER (WHERE identity.disabled_at IS NOT NULL)::TEXT
               AS "disabledIdentities",
             bool_and(session.revoked_at IS NOT NULL) FILTER (
               WHERE session.token_hash = :oldTokenHash
             ) AS "oldSessionRevoked"
           FROM metas.users app_user
           LEFT JOIN metas.auth_identities identity ON identity.user_id = app_user.id
           LEFT JOIN metas.sessions session ON session.user_id = app_user.id
           WHERE app_user.id = :userId
           GROUP BY app_user.id`,
          {
            replacements: {
              oldTokenHash: hashSessionToken(originalLoginBody.sessionToken),
              userId: originalLoginBody.user.id,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        );
        return rows[0];
      });
      assert.deepEqual(stored, {
        activeIdentities: '1',
        disabledIdentities: '1',
        oldSessionRevoked: true,
        primaryEmail: newEmail,
      });
    });

    await test('recurring login uses provider subject instead of a changed email', async () => {
      const fixture = await createEmployeeFixture(migrationDatabase, 'recurring-login');
      const subject = `subject-${randomUUID()}`;
      const verifier = new FakeGoogleVerifier({ email: fixture.email, subject });
      const app = createTestApp(runtimeDatabase, verifier);
      await request(app)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-recurring-token-one' })
        .expect(200);

      verifier.identity = { email: `changed-${randomUUID()}@example.test`, subject };
      const response = await request(app)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-recurring-token-two' })
        .expect(200);
      assert.equal(parseJson<LoginResult>(response.text).user.id, fixture.userId);

      const identities = await withMigrationOwner(migrationDatabase, async (transaction) =>
        migrationDatabase.query<{ count: string }>(
          `SELECT count(*)::TEXT AS count
           FROM metas.auth_identities WHERE user_id = :userId AND provider = 'GOOGLE'`,
          { replacements: { userId: fixture.userId }, transaction, type: QueryTypes.SELECT },
        ),
      );
      assert.equal(identities[0]?.count, '1');
    });

    await test('valid but unauthorized, disabled, inactive and conflicting accounts are denied generically', async () => {
      const sessionsBeforeUnknown = await withMigrationOwner(
        migrationDatabase,
        async (transaction) => {
          const rows = await migrationDatabase.query<{ count: string }>(
            'SELECT count(*)::TEXT AS count FROM metas.sessions',
            { transaction, type: QueryTypes.SELECT },
          );
          return rows[0]?.count;
        },
      );
      const unknownApp = createTestApp(
        runtimeDatabase,
        new FakeGoogleVerifier({
          email: `unknown-${randomUUID()}@example.test`,
          subject: `unknown-${randomUUID()}`,
        }),
      );
      const unknown = await request(unknownApp)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-unknown-account-token' })
        .expect(403);
      assert.equal(parseJson<{ code: string }>(unknown.text).code, 'ACCESS_NOT_AUTHORIZED');
      const sessionsAfterUnknown = await withMigrationOwner(
        migrationDatabase,
        async (transaction) => {
          const rows = await migrationDatabase.query<{ count: string }>(
            'SELECT count(*)::TEXT AS count FROM metas.sessions',
            { transaction, type: QueryTypes.SELECT },
          );
          return rows[0]?.count;
        },
      );
      assert.equal(sessionsAfterUnknown, sessionsBeforeUnknown);

      const disabled = await createEmployeeFixture(migrationDatabase, 'disabled-user', {
        accountStatus: 'DISABLED',
      });
      await request(
        createTestApp(
          runtimeDatabase,
          new FakeGoogleVerifier({ email: disabled.email, subject: `disabled-${randomUUID()}` }),
        ),
      )
        .post('/v1/auth/google')
        .send({ idToken: 'valid-disabled-user-token' })
        .expect(403);

      const inactive = await createEmployeeFixture(migrationDatabase, 'inactive-employee', {
        accountStatus: 'ACTIVE',
        employeeStatus: 'INATIVO',
      });
      await request(
        createTestApp(
          runtimeDatabase,
          new FakeGoogleVerifier({ email: inactive.email, subject: `inactive-${randomUUID()}` }),
        ),
      )
        .post('/v1/auth/google')
        .send({ idToken: 'valid-inactive-employee-token' })
        .expect(403);

      const conflict = await createEmployeeFixture(migrationDatabase, 'identity-conflict', {
        accountStatus: 'ACTIVE',
      });
      await withMigrationOwner(migrationDatabase, async (transaction) => {
        await migrationDatabase.query(
          `INSERT INTO metas.auth_identities (
            user_id, provider, provider_subject, provider_email, provider_verified_at
          ) VALUES (:userId, 'GOOGLE', :subject, :email, now())`,
          {
            replacements: {
              email: conflict.email,
              subject: `existing-${randomUUID()}`,
              userId: conflict.userId,
            },
            transaction,
          },
        );
      });
      await request(
        createTestApp(
          runtimeDatabase,
          new FakeGoogleVerifier({ email: conflict.email, subject: `different-${randomUUID()}` }),
        ),
      )
        .post('/v1/auth/google')
        .send({ idToken: 'valid-conflicting-subject-token' })
        .expect(403);

      const deniedSessions = await withMigrationOwner(migrationDatabase, async (transaction) =>
        migrationDatabase.query<{ count: string }>(
          `SELECT count(*)::TEXT AS count
           FROM metas.sessions
           WHERE user_id IN (:disabledUserId, :inactiveUserId, :conflictUserId)`,
          {
            replacements: {
              conflictUserId: conflict.userId,
              disabledUserId: disabled.userId,
              inactiveUserId: inactive.userId,
            },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      assert.equal(deniedSessions[0]?.count, '0');
    });

    await test('multiple active employee memberships require explicit future selection', async () => {
      const fixture = await createEmployeeFixture(migrationDatabase, 'multiple-memberships', {
        accountStatus: 'ACTIVE',
      });
      const secondStore = await createStoreWithManager(migrationDatabase, 'multiple-store-two');
      await withMigrationOwner(migrationDatabase, async (transaction) => {
        await migrationDatabase.query(
          `INSERT INTO metas.employees (
            store_id, user_id, role, status, joined_on, created_by_user_id, creation_source
          ) VALUES (
            :storeId, :userId, 'CAIXA', 'ATIVO', CURRENT_DATE, :managerUserId, 'MANAGER'
          )`,
          {
            replacements: {
              managerUserId: secondStore.managerUserId,
              storeId: secondStore.storeId,
              userId: fixture.userId,
            },
            transaction,
          },
        );
      });

      const response = await request(
        createTestApp(
          runtimeDatabase,
          new FakeGoogleVerifier({
            email: fixture.email,
            subject: `multiple-${randomUUID()}`,
          }),
        ),
      )
        .post('/v1/auth/google')
        .send({ idToken: 'valid-multiple-memberships-token' })
        .expect(409);
      assert.equal(parseJson<{ code: string }>(response.text).code, 'EMPLOYEE_SELECTION_REQUIRED');
    });

    await test('/v1/me reflects current role and blocks an employee inactivated after login', async () => {
      const fixture = await createEmployeeFixture(migrationDatabase, 'current-role', {
        accountStatus: 'ACTIVE',
      });
      const app = createTestApp(
        runtimeDatabase,
        new FakeGoogleVerifier({ email: fixture.email, subject: `role-${randomUUID()}` }),
      );
      const login = await request(app)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-current-role-token' })
        .expect(200);
      const authorization = `Bearer ${parseJson<LoginResult>(login.text).sessionToken}`;
      const initial = await request(app)
        .get('/v1/me')
        .set('Authorization', authorization)
        .expect(200);
      const initialBody = parseJson<MeResult>(initial.text);
      assert.equal(initialBody.role, 'BALCONISTA');
      assert.deepEqual(Object.keys(initialBody).sort(), [
        'email',
        'id',
        'joinedOn',
        'name',
        'role',
        'status',
      ]);

      await withMigrationOwner(migrationDatabase, async (transaction) => {
        await migrationDatabase.query(
          `UPDATE metas.employees SET role = 'CAIXA' WHERE id = :employeeId`,
          { replacements: { employeeId: fixture.employeeId }, transaction },
        );
      });
      const changed = await request(app)
        .get('/v1/me')
        .set('Authorization', authorization)
        .expect(200);
      assert.equal(parseJson<MeResult>(changed.text).role, 'CAIXA');

      await withMigrationOwner(migrationDatabase, async (transaction) => {
        await migrationDatabase.query(
          `UPDATE metas.employees
           SET status = 'INATIVO', ended_on = CURRENT_DATE
           WHERE id = :employeeId`,
          { replacements: { employeeId: fixture.employeeId }, transaction },
        );
      });
      await request(app).get('/v1/me').set('Authorization', authorization).expect(401);
    });

    await test('expired, revoked and nonexistent opaque sessions are rejected', async () => {
      const fixture = await createEmployeeFixture(migrationDatabase, 'session-states', {
        accountStatus: 'ACTIVE',
      });
      const app = createTestApp(
        runtimeDatabase,
        new FakeGoogleVerifier({ email: fixture.email, subject: `session-${randomUUID()}` }),
      );
      const firstLogin = await request(app)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-expiring-session-token' })
        .expect(200);
      const firstToken = parseJson<LoginResult>(firstLogin.text).sessionToken;
      const firstHash = hashSessionToken(firstToken);
      await withMigrationOwner(migrationDatabase, async (transaction) => {
        await migrationDatabase.query(
          `UPDATE metas.sessions
           SET created_at = now() - interval '2 hours',
               last_seen_at = now() - interval '2 hours',
               expires_at = now() - interval '1 hour'
           WHERE token_hash = :tokenHash`,
          { replacements: { tokenHash: firstHash }, transaction },
        );
      });
      await request(app).get('/v1/me').set('Authorization', `Bearer ${firstToken}`).expect(401);

      const secondLogin = await request(app)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-revoked-session-token' })
        .expect(200);
      const authorization = `Bearer ${parseJson<LoginResult>(secondLogin.text).sessionToken}`;
      await request(app).post('/v1/auth/logout').set('Authorization', authorization).expect(204);
      await request(app).get('/v1/me').set('Authorization', authorization).expect(401);
      await request(app)
        .get('/v1/me')
        .set('Authorization', `Bearer ${'z'.repeat(43)}`)
        .expect(401);
    });

    await test('session-derived RLS context isolates stores and does not leak through the pool', async () => {
      const storeA = await createEmployeeFixture(migrationDatabase, 'session-store-a', {
        accountStatus: 'ACTIVE',
      });
      const storeB = await createEmployeeFixture(migrationDatabase, 'session-store-b', {
        accountStatus: 'ACTIVE',
      });
      const appA = createTestApp(
        runtimeDatabase,
        new FakeGoogleVerifier({ email: storeA.email, subject: `store-a-${randomUUID()}` }),
      );
      const appB = createTestApp(
        runtimeDatabase,
        new FakeGoogleVerifier({ email: storeB.email, subject: `store-b-${randomUUID()}` }),
      );
      const loginA = await request(appA)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-store-a-id-token' })
        .expect(200);
      const loginB = await request(appB)
        .post('/v1/auth/google')
        .send({ idToken: 'valid-store-b-id-token' })
        .expect(200);
      const meA = await request(appA)
        .get('/v1/me')
        .set('Authorization', `Bearer ${parseJson<LoginResult>(loginA.text).sessionToken}`)
        .expect(200);
      const meB = await request(appB)
        .get('/v1/me')
        .set('Authorization', `Bearer ${parseJson<LoginResult>(loginB.text).sessionToken}`)
        .expect(200);
      const meABody = parseJson<MeResult>(meA.text);
      const meBBody = parseJson<MeResult>(meB.text);
      assert.equal(meABody.id, storeA.userId);
      assert.equal(meBBody.id, storeB.userId);
      assert.notEqual(meABody.id, meBBody.id);

      const withoutContext = await runtimeDatabase.query<{ id: string }>(
        'SELECT id FROM metas.employees',
        { type: QueryTypes.SELECT },
      );
      assert.equal(withoutContext.length, 0);
    });

    await test('pre-RLS authentication functions have controlled ownership and grants', async () => {
      const functions = await migrationDatabase.query<{
        functionName: string;
        owner: string;
        publicCanExecute: boolean;
        runtimeCanExecute: boolean;
      }>(
        `SELECT
          procedure.proname AS "functionName",
          owner.rolname AS owner,
          has_function_privilege('public', procedure.oid, 'EXECUTE') AS "publicCanExecute",
          has_function_privilege(
            'metas_app_runtime', procedure.oid, 'EXECUTE'
          ) AS "runtimeCanExecute"
         FROM pg_proc procedure
         JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
         JOIN pg_roles owner ON owner.oid = procedure.proowner
         WHERE namespace.nspname = 'metas'
           AND procedure.proname IN (
             'authenticate_google_identity',
             'resolve_session',
             'revoke_session'
           )
         ORDER BY procedure.proname`,
        { type: QueryTypes.SELECT },
      );
      assert.equal(functions.length, 3);
      assert.ok(
        functions.every(
          ({ owner, publicCanExecute, runtimeCanExecute }) =>
            owner === 'metas_migration_owner' && !publicCanExecute && runtimeCanExecute,
        ),
      );
    });
  } finally {
    await Promise.all([disconnectDatabase(runtimeDatabase), disconnectDatabase(migrationDatabase)]);
  }
}
