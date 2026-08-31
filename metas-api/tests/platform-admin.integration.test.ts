import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import request from 'supertest';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

import { createApp } from '../src/app.js';
import { disconnectDatabase } from '../src/config/database.js';
import {
  assertPlatformAdminRuntimeConnectionSecurity,
  assertRuntimeConnectionSecurity,
} from '../src/database/connectionSecurity.js';
import { createMigrator } from '../src/database/umzug.js';
import type {
  GoogleIdTokenVerifier,
  VerifiedGoogleIdentity,
} from '../src/modules/auth/auth.types.js';
import { hashSessionToken } from '../src/modules/auth/sessionToken.js';
import { PostgresPlatformAdminAuthenticationService } from '../src/modules/platformAdmin/platformAdminAuthenticationService.js';
import type {
  PlatformAdminLoginResult,
  PlatformAdminSession,
} from '../src/modules/platformAdmin/platformAdmin.types.js';
import { AppError } from '../src/shared/errors/AppError.js';
import type { Logger } from '../src/shared/logging/logger.js';
import { withPlatformAdminDatabaseContext } from '../src/shared/database/withPlatformAdminDatabaseContext.js';
import { createIntegrationDatabases } from './integrationDatabase.js';

const silentLogger: Logger = { error: () => undefined, info: () => undefined };

class FakeGoogleVerifier implements GoogleIdTokenVerifier {
  public constructor(private readonly identity: VerifiedGoogleIdentity) {}

  public verify(): Promise<VerifiedGoogleIdentity> {
    return Promise.resolve(this.identity);
  }
}

const withMigrationOwner = async <Result>(
  database: Sequelize,
  callback: (transaction: Transaction) => Promise<Result>,
): Promise<Result> =>
  database.transaction(async (transaction) => {
    await database.query('SET LOCAL ROLE metas_migration_owner', { transaction });
    return callback(transaction);
  });

interface ProvisionedAdmin {
  email: string;
  id: string;
  subject: string;
}

const provisionAdmin = async (database: Sequelize, label: string): Promise<ProvisionedAdmin> => {
  const email = `${label}-${randomUUID()}@example.test`;
  const subject = `google-${label}-${randomUUID()}`;
  const rows = await database.query<{ created: boolean; platformAdminId: string }>(
    `SELECT
      platform_admin_id AS "platformAdminId",
      created
     FROM metas.bootstrap_platform_admin(:displayName, :email, :subject)`,
    {
      replacements: { displayName: `Admin ${label}`, email, subject },
      type: QueryTypes.SELECT,
    },
  );
  assert.equal(rows[0]?.created, true);
  assert.ok(rows[0]?.platformAdminId);
  return { email, id: rows[0].platformAdminId, subject };
};

const createService = (
  database: Sequelize,
  identity: VerifiedGoogleIdentity,
): PostgresPlatformAdminAuthenticationService =>
  new PostgresPlatformAdminAuthenticationService(
    database,
    new FakeGoogleVerifier(identity),
    3_600,
    900,
  );

const login = async (
  database: Sequelize,
  identity: VerifiedGoogleIdentity,
): Promise<PlatformAdminLoginResult> => {
  const response = await request(
    createApp({
      logger: silentLogger,
      platformAdminAuthenticationService: createService(database, identity),
    }),
  )
    .post('/v1/platform-admin/auth/google')
    .send({ idToken: 'valid-platform-admin-id-token' })
    .expect(200);
  return JSON.parse(response.text) as PlatformAdminLoginResult;
};

const testDatabases = createIntegrationDatabases(3, 2);

if (testDatabases === null) {
  await test('platform admin PostgreSQL tests require dedicated test URLs', {
    skip: 'Dedicated runtime, migration and platform admin test URLs are not configured.',
  });
} else {
  const { migrationDatabase, platformAdminRuntimeDatabase, runtimeDatabase } = testDatabases;

  try {
    await migrationDatabase.authenticate();
    await runtimeDatabase.authenticate();
    await platformAdminRuntimeDatabase.authenticate();
    await assertRuntimeConnectionSecurity(runtimeDatabase);
    await assertPlatformAdminRuntimeConnectionSecurity(platformAdminRuntimeDatabase);
    await createMigrator(migrationDatabase).up();

    await test('platform admin bootstrap is exact, idempotent and conflict-safe', async () => {
      const email = `bootstrap-${randomUUID()}@example.test`;
      const subject = `bootstrap-${randomUUID()}`;
      const replacements = { displayName: 'Admin Bootstrap', email, subject };
      const statement = `SELECT
        platform_admin_id AS "platformAdminId",
        identity_id AS "identityId",
        created
       FROM metas.bootstrap_platform_admin(:displayName, :email, :subject)`;
      const first = await migrationDatabase.query<{
        created: boolean;
        identityId: string;
        platformAdminId: string;
      }>(statement, { replacements, type: QueryTypes.SELECT });
      const second = await migrationDatabase.query<{
        created: boolean;
        identityId: string;
        platformAdminId: string;
      }>(statement, { replacements, type: QueryTypes.SELECT });

      assert.equal(first[0]?.created, true);
      assert.equal(second[0]?.created, false);
      assert.equal(second[0]?.platformAdminId, first[0]?.platformAdminId);
      assert.equal(second[0]?.identityId, first[0]?.identityId);
      await assert.rejects(
        migrationDatabase.query(statement, {
          replacements: { ...replacements, subject: `different-${randomUUID()}` },
          type: QueryTypes.SELECT,
        }),
      );
    });

    await test('concurrent platform admin bootstrap does not create duplicates', async () => {
      const replacements = {
        displayName: 'Admin Concurrente',
        email: `concurrent-${randomUUID()}@example.test`,
        subject: `concurrent-${randomUUID()}`,
      };
      const statement = `SELECT created
        FROM metas.bootstrap_platform_admin(:displayName, :email, :subject)`;
      const results = await Promise.all(
        Array.from({ length: 2 }, () =>
          migrationDatabase.query<{ created: boolean }>(statement, {
            replacements,
            type: QueryTypes.SELECT,
          }),
        ),
      );

      assert.deepEqual(results.map((rows) => rows[0]?.created).sort(), [false, true]);
    });

    await test('a provisioned Google subject creates only a hashed GOOGLE_ONLY session', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'login');
      const result = await login(platformAdminRuntimeDatabase, admin);

      assert.equal(result.admin.id, admin.id);
      assert.equal(result.admin.assuranceLevel, 'GOOGLE_ONLY');
      assert.equal(result.admin.primaryEmail, admin.email);
      assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/u);

      const sessionRows = await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query<{
          assuranceLevel: string;
          mfaVerifiedAt: Date | null;
          tokenHashHex: string;
        }>(
          `SELECT
            assurance_level AS "assuranceLevel",
            mfa_verified_at AS "mfaVerifiedAt",
            encode(token_hash, 'hex') AS "tokenHashHex"
           FROM metas.platform_admin_sessions
           WHERE platform_admin_id = :platformAdminId`,
          {
            replacements: { platformAdminId: admin.id },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      assert.equal(sessionRows[0]?.assuranceLevel, 'GOOGLE_ONLY');
      assert.equal(sessionRows[0]?.mfaVerifiedAt, null);
      assert.equal(
        sessionRows[0]?.tokenHashHex,
        hashSessionToken(result.sessionToken).toString('hex'),
      );
      assert.notEqual(sessionRows[0]?.tokenHashHex, result.sessionToken);
    });

    await test('unprovisioned and disabled admins are denied without account enumeration', async () => {
      const unprovisioned = {
        email: `missing-${randomUUID()}@example.test`,
        subject: `missing-${randomUUID()}`,
      };
      await request(
        createApp({
          logger: silentLogger,
          platformAdminAuthenticationService: createService(
            platformAdminRuntimeDatabase,
            unprovisioned,
          ),
        }),
      )
        .post('/v1/platform-admin/auth/google')
        .send({ idToken: 'valid-but-unprovisioned' })
        .expect(403);

      const disabled = await provisionAdmin(migrationDatabase, 'disabled');
      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admins SET status = 'DISABLED' WHERE id = :id`,
          { replacements: { id: disabled.id }, transaction },
        ),
      );
      await request(
        createApp({
          logger: silentLogger,
          platformAdminAuthenticationService: createService(platformAdminRuntimeDatabase, disabled),
        }),
      )
        .post('/v1/platform-admin/auth/google')
        .send({ idToken: 'valid-but-disabled-token' })
        .expect(403);
    });

    await test('expired, revoked and logged-out platform sessions are denied', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'session-state');
      const service = createService(platformAdminRuntimeDatabase, admin);
      const firstLogin = await login(platformAdminRuntimeDatabase, admin);
      const firstSession = await service.authenticateSession(firstLogin.sessionToken);
      assert.equal('tokenHash' in firstSession, false);

      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_sessions
           SET revoked_at = now()
           WHERE id = :sessionId`,
          { replacements: { sessionId: firstSession.sessionId }, transaction },
        ),
      );
      await assert.rejects(service.authenticateSession(firstLogin.sessionToken));

      const secondLogin = await login(platformAdminRuntimeDatabase, admin);
      const secondSession = await service.authenticateSession(secondLogin.sessionToken);
      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_sessions
           SET created_at = now() - interval '2 hours',
               expires_at = now() - interval '1 second',
               idle_expires_at = now() - interval '2 seconds'
           WHERE id = :sessionId`,
          { replacements: { sessionId: secondSession.sessionId }, transaction },
        ),
      );
      await assert.rejects(service.authenticateSession(secondLogin.sessionToken));

      const thirdLogin = await login(platformAdminRuntimeDatabase, admin);
      const app = createApp({ logger: silentLogger, platformAdminAuthenticationService: service });
      await request(app)
        .post('/v1/platform-admin/auth/logout')
        .set('Authorization', `Bearer ${thirdLogin.sessionToken}`)
        .expect(204);
      await request(app)
        .get('/v1/platform-admin/me')
        .set('Authorization', `Bearer ${thirdLogin.sessionToken}`)
        .expect(401);
    });

    await test('session activity is renewed without writing on every request', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'session-touch');
      const service = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const session = await service.authenticateSession(loginResult.sessionToken);
      const readLastSeenAt = async (): Promise<Date> => {
        const rows = await withMigrationOwner(migrationDatabase, (transaction) =>
          migrationDatabase.query<{ lastSeenAt: Date }>(
            `SELECT last_seen_at AS "lastSeenAt"
             FROM metas.platform_admin_sessions
             WHERE id = :sessionId`,
            {
              replacements: { sessionId: session.sessionId },
              transaction,
              type: QueryTypes.SELECT,
            },
          ),
        );
        assert.ok(rows[0]);
        return rows[0].lastSeenAt;
      };

      const firstSeenAt = await readLastSeenAt();
      await service.authenticateSession(loginResult.sessionToken);
      assert.equal((await readLastSeenAt()).getTime(), firstSeenAt.getTime());

      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_sessions
           SET created_at = created_at - interval '3 minutes',
               last_seen_at = now() - interval '2 minutes'
           WHERE id = :sessionId`,
          { replacements: { sessionId: session.sessionId }, transaction },
        ),
      );
      const staleSeenAt = await readLastSeenAt();
      await service.authenticateSession(loginResult.sessionToken);
      assert.ok((await readLastSeenAt()).getTime() > staleSeenAt.getTime());
    });

    await test('a session revoked after authentication is denied without an internal error', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'revocation-race');
      const service = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const session = await service.authenticateSession(loginResult.sessionToken);

      await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query(
          `UPDATE metas.platform_admin_sessions
           SET revoked_at = now()
           WHERE id = :sessionId`,
          { replacements: { sessionId: session.sessionId }, transaction },
        ),
      );

      const isUnauthorized = (error: unknown): boolean =>
        error instanceof AppError && error.statusCode === 401 && error.code === 'UNAUTHORIZED';
      await assert.rejects(service.getMe(session), isUnauthorized);
      await assert.rejects(
        service.logout(session, {
          ipAddress: null,
          requestId: randomUUID(),
          userAgent: 'integration-test',
        }),
        isUnauthorized,
      );
    });

    await test('administrative context is transaction-local and tied to an active session', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'context');
      const service = createService(platformAdminRuntimeDatabase, admin);
      const loginResult = await login(platformAdminRuntimeDatabase, admin);
      const session = await service.authenticateSession(loginResult.sessionToken);

      const me = await service.getMe(session);
      assert.equal(me.id, admin.id);
      await assert.rejects(
        platformAdminRuntimeDatabase.query('SELECT * FROM metas.get_platform_admin_me()'),
      );

      await withPlatformAdminDatabaseContext(
        platformAdminRuntimeDatabase,
        { platformAdminId: session.platformAdminId, sessionId: session.sessionId },
        async (transaction) => {
          const rows = await platformAdminRuntimeDatabase.query<{ id: string }>(
            'SELECT id FROM metas.get_platform_admin_me()',
            { transaction, type: QueryTypes.SELECT },
          );
          assert.equal(rows[0]?.id, admin.id);
        },
      );

      await assert.rejects(
        platformAdminRuntimeDatabase.query('SELECT * FROM metas.get_platform_admin_me()'),
      );
      await assert.rejects(
        withPlatformAdminDatabaseContext(
          platformAdminRuntimeDatabase,
          { platformAdminId: randomUUID(), sessionId: randomUUID() },
          (transaction) =>
            platformAdminRuntimeDatabase.query('SELECT * FROM metas.get_platform_admin_me()', {
              transaction,
            }),
        ),
      );
    });

    await test('platform admin role, RLS, function grants and audit log remain least-privileged', async () => {
      const roles = await migrationDatabase.query<{
        bypassRls: boolean;
        canCreateDatabase: boolean;
        canCreateRole: boolean;
        canLogin: boolean;
        canReplicate: boolean;
        isSuperuser: boolean;
      }>(
        `SELECT
          rolsuper AS "isSuperuser",
          rolcreatedb AS "canCreateDatabase",
          rolcreaterole AS "canCreateRole",
          rolcanlogin AS "canLogin",
          rolreplication AS "canReplicate",
          rolbypassrls AS "bypassRls"
         FROM pg_roles
         WHERE rolname = 'metas_platform_admin_runtime'`,
        { type: QueryTypes.SELECT },
      );
      assert.deepEqual(roles[0], {
        bypassRls: false,
        canCreateDatabase: false,
        canCreateRole: false,
        canLogin: true,
        canReplicate: false,
        isSuperuser: false,
      });

      const tables = await migrationDatabase.query<{
        forceRls: boolean;
        owner: string;
        rls: boolean;
        tableName: string;
      }>(
        `SELECT
          relation.relname AS "tableName",
          owner.rolname AS owner,
          relation.relrowsecurity AS rls,
          relation.relforcerowsecurity AS "forceRls"
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         JOIN pg_roles owner ON owner.oid = relation.relowner
         WHERE namespace.nspname = 'metas'
           AND relation.relname LIKE 'platform_admin%'
           AND relation.relkind = 'r'
         ORDER BY relation.relname`,
        { type: QueryTypes.SELECT },
      );
      assert.equal(tables.length, 4);
      assert.ok(
        tables.every(
          ({ forceRls, owner, rls }) => forceRls && rls && owner === 'metas_migration_owner',
        ),
      );

      for (const table of [
        'platform_admins',
        'platform_admin_identities',
        'platform_admin_sessions',
        'platform_admin_audit_events',
      ]) {
        await assert.rejects(platformAdminRuntimeDatabase.query(`SELECT * FROM metas.${table}`));
      }
      await assert.rejects(
        platformAdminRuntimeDatabase.query(
          `UPDATE metas.platform_admin_audit_events SET outcome = 'FAILURE'`,
        ),
      );
      await assert.rejects(
        platformAdminRuntimeDatabase.query('DELETE FROM metas.platform_admin_audit_events'),
      );
      await assert.rejects(
        runtimeDatabase.query(
          `SELECT * FROM metas.resolve_platform_admin_session(:tokenHash, 900)`,
          { replacements: { tokenHash: randomBytes(32) } },
        ),
      );

      const functions = await migrationDatabase.query<{
        appCanExecute: boolean;
        functionName: string;
        migrationCanExecute: boolean;
        owner: string;
        platformCanExecute: boolean;
        publicCanExecute: boolean;
        searchPath: string[] | null;
      }>(
        `SELECT
          procedure.proname AS "functionName",
          owner.rolname AS owner,
          has_function_privilege('public', procedure.oid, 'EXECUTE') AS "publicCanExecute",
          has_function_privilege(
            'metas_app_runtime', procedure.oid, 'EXECUTE'
          ) AS "appCanExecute",
          has_function_privilege(
            'metas_platform_admin_runtime', procedure.oid, 'EXECUTE'
          ) AS "platformCanExecute",
          has_function_privilege(
            'metas_migration_runner', procedure.oid, 'EXECUTE'
          ) AS "migrationCanExecute",
          procedure.proconfig AS "searchPath"
         FROM pg_proc procedure
         JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
         JOIN pg_roles owner ON owner.oid = procedure.proowner
         WHERE namespace.nspname = 'metas'
           AND procedure.proname IN (
             'authenticate_platform_admin_google',
             'bootstrap_platform_admin',
             'resolve_platform_admin_session',
             'require_platform_admin_context',
             'get_platform_admin_me',
             'revoke_platform_admin_session'
           )
         ORDER BY procedure.proname`,
        { type: QueryTypes.SELECT },
      );
      assert.equal(functions.length, 6);
      assert.ok(
        functions.every(
          ({ appCanExecute, owner, publicCanExecute, searchPath }) =>
            !appCanExecute &&
            owner === 'metas_migration_owner' &&
            !publicCanExecute &&
            searchPath?.includes('search_path=pg_catalog') === true,
        ),
      );
      const byName = new Map(functions.map((item) => [item.functionName, item]));
      assert.equal(byName.get('bootstrap_platform_admin')?.migrationCanExecute, true);
      assert.equal(byName.get('bootstrap_platform_admin')?.platformCanExecute, false);
      assert.equal(byName.get('require_platform_admin_context')?.migrationCanExecute, false);
      assert.equal(byName.get('require_platform_admin_context')?.platformCanExecute, false);
      for (const functionName of [
        'authenticate_platform_admin_google',
        'get_platform_admin_me',
        'resolve_platform_admin_session',
        'revoke_platform_admin_session',
      ]) {
        assert.equal(byName.get(functionName)?.platformCanExecute, true);
        assert.equal(byName.get(functionName)?.migrationCanExecute, false);
      }
    });

    await test('successful authentication events are append-only and sanitized', async () => {
      const admin = await provisionAdmin(migrationDatabase, 'audit');
      const result = await login(platformAdminRuntimeDatabase, admin);
      const service = createService(platformAdminRuntimeDatabase, admin);
      const session: PlatformAdminSession = await service.authenticateSession(result.sessionToken);
      await service.logout(session, {
        ipAddress: null,
        requestId: randomUUID(),
        userAgent: 'integration-test',
      });

      const events = await withMigrationOwner(migrationDatabase, (transaction) =>
        migrationDatabase.query<{ action: string; metadata: Record<string, unknown> }>(
          `SELECT action, metadata
           FROM metas.platform_admin_audit_events
           WHERE platform_admin_id = :platformAdminId
           ORDER BY created_at, id`,
          {
            replacements: { platformAdminId: admin.id },
            transaction,
            type: QueryTypes.SELECT,
          },
        ),
      );
      assert.deepEqual(
        events.map(({ action }) => action),
        ['PLATFORM_ADMIN_LOGIN', 'PLATFORM_ADMIN_LOGOUT'],
      );
      assert.doesNotMatch(JSON.stringify(events), /token|password|secret|google-id/u);
    });
  } finally {
    await Promise.all([
      disconnectDatabase(platformAdminRuntimeDatabase),
      disconnectDatabase(runtimeDatabase),
      disconnectDatabase(migrationDatabase),
    ]);
  }
}
