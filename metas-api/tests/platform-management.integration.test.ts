import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Sequelize, QueryTypes } from 'sequelize';
import { PostgresManagementService } from '../src/modules/platformManagement/management.service.js';
import { listInputSchema } from '../src/modules/platformManagement/management.contracts.js';
import { PostgresPlatformAdminAccessService } from '../src/modules/platformAdminAccess/platformAdminAccess.service.js';
import type { PlatformAdminSession } from '../src/modules/platformAdmin/platformAdmin.types.js';
import { withDatabaseContext } from '../src/shared/database/withDatabaseContext.js';
import { withPlatformAdminDatabaseContext } from '../src/shared/database/withPlatformAdminDatabaseContext.js';

const execute = (
  command: string,
  args: string[],
  _options: { windowsHide: boolean },
): Promise<void> =>
  new Promise((resolve, reject) => {
    void _options;
    const process = spawn(command, args, { windowsHide: true, stdio: 'ignore', timeout: 30000 });
    process.once('error', reject);
    process.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`LOCAL_POSTGRES_PROCESS_FAILED:${path.basename(command)}:${code}`)),
    );
  });
const binaries = process.env.METAS_LOCAL_POSTGRES_BIN ?? 'C:/Program Files/PostgreSQL/18/bin';
void test(
  'gestão: migration e operações transacionais em PostgreSQL descartável exclusivamente local',
  {
    skip: !existsSync(path.join(binaries, 'initdb.exe')),
    timeout: 120000,
  },
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'metas-management-test-'));
    const data = path.join(directory, 'data');
    const listener = createServer();
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const address = listener.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    let started = false;
    const connections: Sequelize[] = [];
    const connect = (username: string) => {
      const db = new Sequelize('postgres', username, '', {
        host: '127.0.0.1',
        port,
        dialect: 'postgres',
        logging: false,
        pool: { max: 2 },
      });
      connections.push(db);
      return db;
    };
    try {
      await execute(
        path.join(binaries, 'initdb.exe'),
        ['-D', data, '-U', 'metas_test_admin', '-A', 'trust', '--no-locale', '--encoding=UTF8'],
        { windowsHide: true },
      );
      await execute(
        path.join(binaries, 'pg_ctl.exe'),
        [
          '-D',
          data,
          '-l',
          path.join(directory, 'postgres.log'),
          '-o',
          `-h 127.0.0.1 -p ${port}`,
          '-w',
          'start',
        ],
        { windowsHide: true },
      );
      started = true;
      const admin = connect('metas_test_admin');
      await admin.query(`
      CREATE ROLE metas_migration_owner NOLOGIN;
      CREATE ROLE metas_migration_runner LOGIN NOINHERIT;
      CREATE ROLE metas_app_runtime LOGIN NOINHERIT;
      CREATE ROLE metas_platform_admin_runtime LOGIN NOINHERIT;
      CREATE ROLE metas_platform_admin_operator LOGIN NOINHERIT;
      GRANT metas_migration_owner TO metas_migration_runner;
      CREATE EXTENSION citext;
      CREATE EXTENSION btree_gist;
      CREATE SCHEMA metas AUTHORIZATION metas_migration_owner;
      GRANT USAGE ON SCHEMA metas TO metas_migration_runner,metas_app_runtime,metas_platform_admin_runtime,metas_platform_admin_operator;
      ALTER DEFAULT PRIVILEGES FOR ROLE metas_migration_owner IN SCHEMA metas REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    `);
      const migrationDirectory = path.resolve(import.meta.dirname, '../src/database/migrations');
      for (const file of (await readdir(migrationDirectory))
        .filter((name) => /^\d{3}-.*\.ts$/u.test(name))
        .sort()) {
        const migration = (await import(
          pathToFileURL(path.join(migrationDirectory, file)).href
        )) as { up(input: { context: Sequelize; name: string }): Promise<void> };
        await migration.up({ context: admin, name: file });
      }
      const adminId = randomUUID(),
        identityId = randomUUID(),
        sessionId = randomUUID();
      await admin.query(
        `
      INSERT INTO metas.platform_admins(id,display_name,primary_email) VALUES (:adminId,'Admin Sintético','admin@example.test');
      INSERT INTO metas.platform_admin_identities(id,platform_admin_id,provider,provider_subject,provider_verified_at)
        VALUES (:identityId,:adminId,'GOOGLE','synthetic-subject',now());
      INSERT INTO metas.platform_admin_sessions(id,platform_admin_id,identity_id,token_hash,assurance_level,mfa_verified_at,step_up_verified_at,expires_at,idle_expires_at)
        VALUES (:sessionId,:adminId,:identityId,decode(repeat('ab',32),'hex'),'MFA_VERIFIED',now(),now(),now()+interval '1 hour',now()+interval '30 minutes');
    `,
        { replacements: { adminId, identityId, sessionId } },
      );
      const runtime = connect('metas_platform_admin_runtime');
      const appRuntime = connect('metas_app_runtime');
      const service = new PostgresManagementService(runtime);
      const accessService = new PostgresPlatformAdminAccessService(runtime, 300, 604800, 300);
      const session: PlatformAdminSession = {
        platformAdminId: adminId,
        sessionId,
        assuranceLevel: 'MFA_VERIFIED',
        expiresAt: '',
        mfaVerifiedAt: '',
        stepUpVerifiedAt: new Date().toISOString(),
      };
      const hasDatabaseMessage = (expected: string) => (error: unknown) =>
        error instanceof Error &&
        'parent' in error &&
        error.parent instanceof Error &&
        error.parent.message === expected;
      const googleLogin = (email: string, subject: string) =>
        runtime.query<{
          platform_admin_id: string;
          session_id: string;
          assurance_level: string;
        }>(
          `SELECT * FROM metas.authenticate_platform_admin_google(
            :subject,:email,:tokenHash,
            CURRENT_TIMESTAMP + interval '1 hour',
            CURRENT_TIMESTAMP + interval '30 minutes',
            NULL,NULL,CAST(:requestId AS UUID)
          )`,
          {
            replacements: { email, requestId: randomUUID(), subject, tokenHash: randomBytes(32) },
            type: QueryTypes.SELECT,
          },
        );
      const write = (
        operation: 'savePharmacy' | 'updateEmployee' | 'linkEmployee',
        id: string | null,
        input: unknown,
      ) => service.write(session, operation, id, input, randomUUID());
      const createEmployee = (input: {
        email: string;
        name: string;
        role: 'GESTOR' | 'BALCONISTA' | 'CAIXA' | 'FARMACEUTICO';
        storeId: string;
      }) => service.createEmployee(session, input, randomUUID());
      const deleteEmployee = (
        employeeId: string,
        input: { version: number; userVersion: number },
      ) => service.deleteEmployee(session, employeeId, input, randomUUID());
      const employeeGoogleLogin = (email: string, subject: string) =>
        appRuntime.query<{
          employee_id: string;
          role: string;
          store_id: string;
          user_id: string;
        }>(
          `SELECT * FROM metas.authenticate_google_identity(
            :subject,:email,:tokenHash,CURRENT_TIMESTAMP+interval '1 hour',NULL,NULL
          )`,
          {
            replacements: { email, subject, tokenHash: randomBytes(32) },
            type: QueryTypes.SELECT,
          },
        );
      let storeId = '';
      await t.test(
        'criar, buscar, filtrar, paginar, editar e desativar farmácia com auditoria',
        async () => {
          const created = await write('savePharmacy', null, {
            name: 'Farmácia Centro',
            slug: 'centro',
            timezone: 'America/Sao_Paulo',
            isActive: true,
          });
          storeId = created.id;
          const result = (await service.list(
            session,
            'pharmacies',
            listInputSchema.parse({ q: 'Centro' }),
          )) as { items: { id: string; version: number }[]; total: number };
          assert.equal(result.total, 1);
          assert.equal(result.items[0]?.id, storeId);
          await write('savePharmacy', storeId, {
            name: 'Farmácia Centro',
            slug: 'centro',
            timezone: 'America/Sao_Paulo',
            isActive: false,
            version: 1,
          });
          const inactive = (await service.list(
            session,
            'pharmacies',
            listInputSchema.parse({ status: 'INACTIVE' }),
          )) as { total: number };
          assert.equal(inactive.total, 1);
          await assert.rejects(
            write('savePharmacy', storeId, {
              name: 'Outro nome',
              slug: 'centro',
              timezone: 'America/Sao_Paulo',
              isActive: true,
              version: 1,
            }),
            { code: 'MANAGEMENT_VERSION_CONFLICT' },
          );
          await write('savePharmacy', storeId, {
            name: 'Farmácia Centro',
            slug: 'centro',
            timezone: 'America/Sao_Paulo',
            isActive: true,
            version: 2,
          });
          const audit = (await service.list(session, 'audit', listInputSchema.parse({}))) as {
            total: number;
          };
          assert.equal(audit.total, 3);
        },
      );
      await t.test(
        'provisiona gestor e funcionario atomicamente, associa Google verificado e audita',
        async () => {
          const store = await write('savePharmacy', null, {
            name: 'Santa Afonso',
            slug: 'santa-afonso',
            timezone: 'America/Sao_Paulo',
            isActive: true,
          });
          await assert.rejects(
            createEmployee({
              name: 'Primeira Pessoa Invalida',
              email: 'primeira-invalida@example.test',
              storeId: store.id,
              role: 'CAIXA',
            }),
            { code: 'FIRST_EMPLOYEE_MUST_BE_BOOTSTRAP_MANAGER' },
          );
          const [rolledBack] = await admin.query<{ total: string }>(
            "SELECT count(*)::TEXT total FROM metas.users WHERE primary_email='primeira-invalida@example.test'",
            { type: QueryTypes.SELECT },
          );
          assert.equal(rolledBack?.total, '0');

          const manager = await createEmployee({
            name: 'Gestora Santa Afonso',
            email: 'gestora.santa@example.test',
            storeId: store.id,
            role: 'GESTOR',
          });
          const employee = await createEmployee({
            name: 'Funcionaria Santa Afonso',
            email: 'funcionaria.santa@example.test',
            storeId: store.id,
            role: 'FARMACEUTICO',
          });
          const records = await admin.query<{
            account_status: string;
            created_by_platform_admin_id: string;
            id: string;
            role: string;
            store_id: string;
          }>(
            `SELECT e.id,e.store_id,e.role::TEXT,u.account_status,e.created_by_platform_admin_id
             FROM metas.employees e JOIN metas.users u ON u.id=e.user_id
             WHERE e.id IN(:managerId,:employeeId) ORDER BY e.role`,
            {
              replacements: { employeeId: employee.id, managerId: manager.id },
              type: QueryTypes.SELECT,
            },
          );
          assert.equal(records.length, 2);
          assert.equal(
            records.every((record) => record.store_id === store.id),
            true,
          );
          assert.equal(
            records.every((record) => record.account_status === 'PENDING'),
            true,
          );
          assert.equal(
            records.every((record) => record.created_by_platform_admin_id === adminId),
            true,
          );

          await assert.rejects(
            employeeGoogleLogin('outra@example.test', 'employee-google-subject'),
            hasDatabaseMessage('AUTH_ACCESS_DENIED'),
          );
          const [login] = await employeeGoogleLogin(
            'FUNCIONARIA.SANTA@example.test',
            'employee-google-subject',
          );
          assert.equal(login?.employee_id, employee.id);
          assert.equal(login?.store_id, store.id);
          assert.equal(login?.role, 'FARMACEUTICO');

          const [identity] = await admin.query<{ provider_subject: string }>(
            `SELECT provider_subject FROM metas.auth_identities
             WHERE user_id=:userId AND provider='GOOGLE' AND disabled_at IS NULL`,
            { replacements: { userId: login?.user_id }, type: QueryTypes.SELECT },
          );
          assert.equal(identity?.provider_subject, 'employee-google-subject');
          const [audit] = await admin.query<{ metadata: { role: string }; store_id: string }>(
            `SELECT store_id,metadata FROM metas.platform_admin_audit_events
             WHERE action='EMPLOYEE_CREATED' AND target_id=:employeeId`,
            { replacements: { employeeId: employee.id }, type: QueryTypes.SELECT },
          );
          assert.equal(audit?.store_id, store.id);
          assert.equal(audit?.metadata.role, 'FARMACEUTICO');
        },
      );
      let restrictedStoreId = '';
      await t.test(
        'rejeita duplicidade, loja inativa, multiplas farmacias e step-up vencido',
        async () => {
          const destination = await write('savePharmacy', null, {
            name: 'Farmacia Restrita',
            slug: 'restrita',
            timezone: 'America/Sao_Paulo',
            isActive: true,
          });
          restrictedStoreId = destination.id;
          await createEmployee({
            name: 'Gestora Restrita',
            email: 'gestora.restrita@example.test',
            storeId: destination.id,
            role: 'GESTOR',
          });
          await assert.rejects(
            createEmployee({
              name: 'Gestora Restrita',
              email: 'gestora.restrita@example.test',
              storeId: destination.id,
              role: 'GESTOR',
            }),
            { code: 'MANAGEMENT_LINK_EXISTS' },
          );

          const another = await write('savePharmacy', null, {
            name: 'Farmacia Outra',
            slug: 'outra',
            timezone: 'America/Sao_Paulo',
            isActive: true,
          });
          await assert.rejects(
            createEmployee({
              name: 'Gestora Restrita',
              email: 'gestora.restrita@example.test',
              storeId: another.id,
              role: 'GESTOR',
            }),
            { code: 'MANAGEMENT_MULTIPLE_STORES_UNSUPPORTED' },
          );
          await admin.query(
            `INSERT INTO metas.users(full_name,primary_email,account_status)
             VALUES('Pessoa sem vínculo','sem-vinculo@example.test','PENDING')`,
          );
          await assert.rejects(
            createEmployee({
              name: 'Pessoa sem vínculo',
              email: 'sem-vinculo@example.test',
              storeId: destination.id,
              role: 'CAIXA',
            }),
            { code: 'MANAGEMENT_EMPLOYEE_EMAIL_EXISTS' },
          );
          await assert.rejects(
            createEmployee({
              name: 'Farmácia inexistente',
              email: 'loja-inexistente@example.test',
              storeId: randomUUID(),
              role: 'GESTOR',
            }),
            { code: 'MANAGEMENT_STORE_INACTIVE' },
          );
          await write('savePharmacy', another.id, {
            name: 'Farmacia Outra',
            slug: 'outra',
            timezone: 'America/Sao_Paulo',
            isActive: false,
            version: 1,
          });
          await assert.rejects(
            createEmployee({
              name: 'Pessoa Inativa',
              email: 'inativa@example.test',
              storeId: another.id,
              role: 'GESTOR',
            }),
            { code: 'MANAGEMENT_STORE_INACTIVE' },
          );

          await admin.query(
            `UPDATE metas.platform_admin_sessions
             SET created_at=now()-interval '10 minutes',
                 mfa_verified_at=now()-interval '6 minutes',
                 step_up_verified_at=now()-interval '6 minutes'
             WHERE id=:sessionId`,
            { replacements: { sessionId } },
          );
          await assert.rejects(
            createEmployee({
              name: 'Sem Step-up',
              email: 'sem-step-up-employee@example.test',
              storeId: destination.id,
              role: 'CAIXA',
            }),
            { code: 'PLATFORM_ADMIN_STEP_UP_REQUIRED' },
          );
          await admin.query(
            'UPDATE metas.platform_admin_sessions SET mfa_verified_at=now(),step_up_verified_at=now() WHERE id=:sessionId',
            { replacements: { sessionId } },
          );
        },
      );
      await t.test('RLS impede leitura cruzada e troca arbitraria de farmacia', async () => {
        const [userA] = await employeeGoogleLogin(
          'gestora.santa@example.test',
          'manager-a-subject',
        );
        const [userB] = await employeeGoogleLogin(
          'gestora.restrita@example.test',
          'manager-b-subject',
        );
        assert.ok(userA && userB);
        const visibleStores = async (context: typeof userA) =>
          withDatabaseContext(
            appRuntime,
            {
              employeeId: context.employee_id,
              storeId: context.store_id,
              userId: context.user_id,
            },
            (transaction) =>
              appRuntime.query<{ id: string }>('SELECT id FROM metas.stores', {
                transaction,
                type: QueryTypes.SELECT,
              }),
          );
        assert.deepEqual(
          (await visibleStores(userA)).map(({ id }) => id),
          [userA.store_id],
        );
        assert.deepEqual(
          (await visibleStores(userB)).map(({ id }) => id),
          [userB.store_id],
        );
        assert.equal(userB.store_id, restrictedStoreId);
        assert.deepEqual(await visibleStores({ ...userA, store_id: userB.store_id }), []);
      });

      await t.test(
        'exclusão preserva histórico, revoga sessão e identidade e bloqueia novo acesso',
        async () => {
          const store = await write('savePharmacy', null, {
            name: 'Farmácia Exclusão',
            slug: 'exclusao',
            timezone: 'America/Sao_Paulo',
            isActive: true,
          });
          const manager = await createEmployee({
            name: 'Gestora Exclusão',
            email: 'gestora.exclusao@example.test',
            storeId: store.id,
            role: 'GESTOR',
          });
          const employee = await createEmployee({
            name: 'Pessoa Excluída',
            email: 'excluida@example.test',
            storeId: store.id,
            role: 'CAIXA',
          });
          const [managerLogin] = await employeeGoogleLogin(
            'gestora.exclusao@example.test',
            'manager-delete-subject',
          );
          const [employeeLogin] = await employeeGoogleLogin(
            'excluida@example.test',
            'employee-delete-subject',
          );
          assert.ok(managerLogin && employeeLogin);
          const [versions] = await admin.query<{ user_version: number; version: number }>(
            `SELECT e.lock_version version,u.lock_version user_version
             FROM metas.employees e JOIN metas.users u ON u.id=e.user_id
             WHERE e.id=:employeeId`,
            { replacements: { employeeId: employee.id }, type: QueryTypes.SELECT },
          );

          await assert.rejects(
            deleteEmployee(employee.id, {
              version: versions!.version + 1,
              userVersion: versions!.user_version,
            }),
            { code: 'MANAGEMENT_VERSION_CONFLICT' },
          );
          await assert.rejects(deleteEmployee(randomUUID(), { version: 1, userVersion: 1 }), {
            code: 'MANAGEMENT_NOT_FOUND',
          });

          await deleteEmployee(employee.id, {
            version: versions!.version,
            userVersion: versions!.user_version,
          });

          const listed = (await service.list(
            session,
            'employees',
            listInputSchema.parse({ storeId: store.id }),
          )) as { items: { id: string }[] };
          assert.equal(
            listed.items.some(({ id }) => id === employee.id),
            false,
          );
          const [preserved] = await admin.query<{
            account_status: string;
            deleted: boolean;
            identity_disabled: boolean;
            session_revoked: boolean;
          }>(
            `SELECT u.account_status,e.deleted_at IS NOT NULL deleted,
              identity.disabled_at IS NOT NULL identity_disabled,
              session.revoked_at IS NOT NULL session_revoked
             FROM metas.employees e
             JOIN metas.users u ON u.id=e.user_id
             JOIN metas.auth_identities identity ON identity.user_id=u.id
             JOIN metas.sessions session ON session.employee_id=e.id
             WHERE e.id=:employeeId`,
            { replacements: { employeeId: employee.id }, type: QueryTypes.SELECT },
          );
          assert.deepEqual(preserved, {
            account_status: 'DISABLED',
            deleted: true,
            identity_disabled: true,
            session_revoked: true,
          });
          await assert.rejects(
            employeeGoogleLogin('excluida@example.test', 'employee-delete-subject'),
            hasDatabaseMessage('AUTH_ACCESS_DENIED'),
          );
          await assert.rejects(
            deleteEmployee(employee.id, {
              version: versions!.version + 1,
              userVersion: versions!.user_version + 1,
            }),
            { code: 'MANAGEMENT_EMPLOYEE_ALREADY_DELETED' },
          );
          await assert.rejects(
            write('updateEmployee', employee.id, {
              name: 'Pessoa ExcluÃ­da',
              role: 'CAIXA',
              status: 'ATIVO',
              version: versions!.version + 1,
              userVersion: versions!.user_version + 1,
            }),
            { code: 'MANAGEMENT_EMPLOYEE_ALREADY_DELETED' },
          );
          await assert.rejects(
            withDatabaseContext(
              appRuntime,
              {
                employeeId: managerLogin.employee_id,
                storeId: managerLogin.store_id,
                userId: managerLogin.user_id,
              },
              (transaction) =>
                appRuntime.query(
                  `SELECT * FROM metas.manager_change_employee_access_email(
                    CAST(:employeeId AS UUID), :email
                  )`,
                  {
                    replacements: {
                      email: 'novo.acesso@example.test',
                      employeeId: employee.id,
                    },
                    transaction,
                    type: QueryTypes.SELECT,
                  },
                ),
            ),
            hasDatabaseMessage('EMPLOYEE_NOT_FOUND'),
          );
          const visibleEmployees = await withDatabaseContext(
            appRuntime,
            {
              employeeId: managerLogin.employee_id,
              storeId: managerLogin.store_id,
              userId: managerLogin.user_id,
            },
            (transaction) =>
              appRuntime.query<{ id: string }>('SELECT id FROM metas.employees ORDER BY id', {
                transaction,
                type: QueryTypes.SELECT,
              }),
          );
          assert.deepEqual(
            visibleEmployees.map(({ id }) => id),
            [manager.id],
          );
          const [audit] = await admin.query<{ total: string }>(
            `SELECT count(*)::TEXT total FROM metas.platform_admin_audit_events
             WHERE action='EMPLOYEE_DELETED' AND target_id=:employeeId AND store_id=:storeId`,
            {
              replacements: { employeeId: employee.id, storeId: store.id },
              type: QueryTypes.SELECT,
            },
          );
          assert.equal(audit?.total, '1');

          const pending = await createEmployee({
            name: 'Pessoa Pendente Excluída',
            email: 'pendente.excluida@example.test',
            storeId: store.id,
            role: 'BALCONISTA',
          });
          await deleteEmployee(pending.id, { version: 1, userVersion: 1 });
          await assert.rejects(
            employeeGoogleLogin('pendente.excluida@example.test', 'pending-delete-subject'),
            hasDatabaseMessage('AUTH_ACCESS_DENIED'),
          );

          const [managerVersions] = await admin.query<{ user_version: number; version: number }>(
            `SELECT e.lock_version version,u.lock_version user_version
             FROM metas.employees e JOIN metas.users u ON u.id=e.user_id WHERE e.id=:employeeId`,
            { replacements: { employeeId: manager.id }, type: QueryTypes.SELECT },
          );
          await assert.rejects(
            deleteEmployee(manager.id, {
              version: managerVersions!.version,
              userVersion: managerVersions!.user_version,
            }),
            { code: 'LAST_ACTIVE_MANAGER_DELETE_REQUIRED' },
          );
        },
      );

      await t.test('concorrência nunca exclui os dois últimos gestores ativos', async () => {
        const store = await write('savePharmacy', null, {
          name: 'Farmácia Concorrente',
          slug: 'concorrente',
          timezone: 'America/Sao_Paulo',
          isActive: true,
        });
        const first = await createEmployee({
          name: 'Primeira Gestora Concorrente',
          email: 'primeira.concorrente@example.test',
          storeId: store.id,
          role: 'GESTOR',
        });
        const second = await createEmployee({
          name: 'Segunda Gestora Concorrente',
          email: 'segunda.concorrente@example.test',
          storeId: store.id,
          role: 'GESTOR',
        });
        const results = await Promise.allSettled([
          deleteEmployee(first.id, { version: 1, userVersion: 1 }),
          deleteEmployee(second.id, { version: 1, userVersion: 1 }),
        ]);
        assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
        assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
        const [remaining] = await admin.query<{ total: string }>(
          `SELECT count(*)::TEXT total FROM metas.employees
           WHERE store_id=:storeId AND role='GESTOR' AND status='ATIVO' AND deleted_at IS NULL`,
          { replacements: { storeId: store.id }, type: QueryTypes.SELECT },
        );
        assert.equal(remaining?.total, '1');
      });

      const userId = randomUUID(),
        employeeId = randomUUID();
      await admin.query(
        `
      INSERT INTO metas.users(id,full_name,primary_email,account_status) VALUES(:userId,'Pessoa Sintética','person@example.test','ACTIVE');
      INSERT INTO metas.employees(id,store_id,user_id,role,status,joined_on,creation_source)
      VALUES(:employeeId,:storeId,:userId,'GESTOR','ATIVO',CURRENT_DATE,'BOOTSTRAP');
      INSERT INTO metas.sessions(user_id,employee_id,expires_at,token_hash) VALUES(:userId,:employeeId,now()+interval '1 hour',decode(repeat('cd',32),'hex'));
    `,
        { replacements: { userId, employeeId, storeId } },
      );
      await t.test(
        'último gestor, roles arbitrários e conflito de versão são rejeitados sem escrita parcial',
        async () => {
          const input = {
            name: 'Não persistir',
            role: 'GESTOR',
            status: 'INATIVO',
            version: 1,
            userVersion: 1,
          };
          await assert.rejects(write('updateEmployee', employeeId, input), {
            code: 'LAST_ACTIVE_MANAGER_REQUIRED',
          });
          await assert.rejects(
            write('updateEmployee', employeeId, { ...input, role: 'PLATFORM_ADMIN' }),
            { code: 'MANAGEMENT_INVALID_INPUT' },
          );
          const [person] = await admin.query<{ full_name: string }>(
            'SELECT full_name FROM metas.users WHERE id=:userId',
            { replacements: { userId }, type: QueryTypes.SELECT },
          );
          assert.equal(person?.full_name, 'Pessoa Sintética');
        },
      );
      await t.test(
        'vínculo novo preserva história e atribui autoria ao Platform Admin',
        async () => {
          const destination = await write('savePharmacy', null, {
            name: 'Farmácia Norte',
            slug: 'norte',
            timezone: 'America/Sao_Paulo',
            isActive: true,
          });
          await assert.rejects(
            write('linkEmployee', employeeId, { storeId: destination.id, role: 'CAIXA' }),
            { code: 'FIRST_EMPLOYEE_MUST_BE_BOOTSTRAP_MANAGER' },
          );
          const linked = await write('linkEmployee', employeeId, {
            storeId: destination.id,
            role: 'GESTOR',
          });
          const [record] = await admin.query<{
            creation_source: string;
            created_by_platform_admin_id: string;
          }>(
            'SELECT creation_source,created_by_platform_admin_id FROM metas.employees WHERE id=:id',
            { replacements: { id: linked.id }, type: QueryTypes.SELECT },
          );
          assert.equal(record?.creation_source, 'PLATFORM_ADMIN');
          assert.equal(record?.created_by_platform_admin_id, adminId);
          await assert.rejects(
            write('linkEmployee', employeeId, { storeId: destination.id, role: 'GESTOR' }),
            { code: 'MANAGEMENT_LINK_EXISTS' },
          );
          const [old] = await admin.query<{ store_id: string }>(
            'SELECT store_id FROM metas.employees WHERE id=:id',
            { replacements: { id: employeeId }, type: QueryTypes.SELECT },
          );
          assert.equal(old?.store_id, storeId);
        },
      );
      await t.test(
        'editar nome e função, desativar e reativar preserva vínculos e revoga sessões',
        async () => {
          const secondUser = randomUUID();
          await admin.query(
            `
        INSERT INTO metas.users(id,full_name,primary_email,account_status)
        VALUES(:secondUser,'Segunda Gestora','second@example.test','ACTIVE');
        INSERT INTO metas.employees(store_id,user_id,role,status,joined_on,creation_source,created_by_user_id)
        VALUES(:storeId,:secondUser,'GESTOR','ATIVO',CURRENT_DATE,'MANAGER',:userId);
      `,
            { replacements: { secondUser, storeId, userId } },
          );
          await write('updateEmployee', employeeId, {
            name: 'Pessoa Atualizada',
            role: 'CAIXA',
            status: 'ATIVO',
            version: 1,
            userVersion: 1,
          });
          await write('updateEmployee', employeeId, {
            name: 'Pessoa Atualizada',
            role: 'CAIXA',
            status: 'INATIVO',
            version: 2,
            userVersion: 2,
          });
          const result = (await service.list(
            session,
            'employees',
            listInputSchema.parse({ status: 'INACTIVE', storeId }),
          )) as { items: { id: string; name: string }[] };
          assert.equal(result.items[0]?.id, employeeId);
          assert.equal(result.items[0]?.name, 'Pessoa Atualizada');
          await write('updateEmployee', employeeId, {
            name: 'Pessoa Atualizada',
            role: 'CAIXA',
            status: 'ATIVO',
            version: 3,
            userVersion: 3,
          });
          const [record] = await admin.query<{ revoked: boolean }>(
            'SELECT revoked_at IS NOT NULL AS revoked FROM metas.sessions WHERE employee_id=:id',
            { replacements: { id: employeeId }, type: QueryTypes.SELECT },
          );
          assert.equal(record?.revoked, true);
          await admin.query(
            "INSERT INTO metas.sessions(user_id,employee_id,expires_at,token_hash) VALUES(:userId,:employeeId,now()+interval '1 hour',decode(repeat('ef',32),'hex'))",
            { replacements: { userId, employeeId } },
          );
        },
      );
      await t.test('desativação de farmácia revoga sessões sem apagar histórico', async () => {
        await write('savePharmacy', storeId, {
          name: 'Farmácia Centro',
          slug: 'centro',
          timezone: 'America/Sao_Paulo',
          isActive: false,
          version: 3,
        });
        const [record] = await admin.query<{ revoked: boolean }>(
          'SELECT revoked_at IS NOT NULL AS revoked FROM metas.sessions WHERE employee_id=:id',
          { replacements: { id: employeeId }, type: QueryTypes.SELECT },
        );
        assert.equal(record?.revoked, true);
      });
      await t.test(
        'autoriza e cancela acessos pendentes com step-up, unicidade e auditoria transacional',
        async () => {
          await admin.query(
            `UPDATE metas.platform_admin_sessions
             SET created_at=now()-interval '10 minutes',
                 mfa_verified_at=now()-interval '6 minutes',
                 step_up_verified_at=now()-interval '6 minutes'
             WHERE id=:id`,
            { replacements: { id: sessionId } },
          );
          await assert.rejects(
            accessService.invite(
              session,
              { displayName: 'Sem Step-up', email: 'sem-step-up@example.test' },
              randomUUID(),
            ),
            { code: 'PLATFORM_ADMIN_STEP_UP_REQUIRED' },
          );
          await admin.query(
            'UPDATE metas.platform_admin_sessions SET mfa_verified_at=now(),step_up_verified_at=now() WHERE id=:id',
            { replacements: { id: sessionId } },
          );
          const invitation = await accessService.invite(
            session,
            { displayName: 'Nova Admin', email: 'nova@example.test' },
            randomUUID(),
          );
          const listed = await accessService.list(session);
          assert.equal(
            listed.items.some((item) => item.invitationId === invitation.id),
            true,
          );
          await assert.rejects(
            accessService.invite(
              session,
              { displayName: 'Duplicada', email: 'NOVA@example.test' },
              randomUUID(),
            ),
            { code: 'PLATFORM_ADMIN_INVITATION_ALREADY_PENDING' },
          );
          await assert.rejects(
            accessService.invite(
              session,
              { displayName: 'Existente', email: 'admin@example.test' },
              randomUUID(),
            ),
            { code: 'PLATFORM_ADMIN_ACCESS_ALREADY_EXISTS' },
          );
          await accessService.cancel(session, invitation.id, randomUUID());
          await assert.rejects(
            googleLogin('nova@example.test', 'cancelled-subject'),
            hasDatabaseMessage('PLATFORM_ADMIN_ACCESS_DENIED'),
          );

          await assert.rejects(
            withPlatformAdminDatabaseContext(
              runtime,
              { platformAdminId: adminId, sessionId },
              (transaction) =>
                runtime.query(
                  `SELECT metas.create_platform_admin_invitation(
                    NULL,NULL,NULL,CURRENT_TIMESTAMP-interval '5 minutes',NULL
                  )`,
                  { transaction },
                ),
            ),
            hasDatabaseMessage('PLATFORM_ADMIN_ACCESS_INVALID_INPUT'),
          );
          const [audit] = await admin.query<{ total: string }>(
            `SELECT count(*)::TEXT total FROM metas.platform_admin_audit_events
             WHERE action IN ('PLATFORM_ADMIN_INVITATION_CREATED','PLATFORM_ADMIN_INVITATION_CANCELLED')`,
            { type: QueryTypes.SELECT },
          );
          assert.equal(audit?.total, '2');
        },
      );

      let invitedAdminId = '';
      let invitedSessionId = '';
      await t.test(
        'aceita somente o e-mail Google autorizado e nunca reassocia um subject existente',
        async () => {
          await accessService.invite(
            session,
            { displayName: 'Pessoa Convidada', email: 'convidada@example.test' },
            randomUUID(),
          );
          await assert.rejects(
            googleLogin('outra@example.test', 'invited-subject'),
            hasDatabaseMessage('PLATFORM_ADMIN_ACCESS_DENIED'),
          );
          const authenticated = await googleLogin('CONVIDADA@example.test', 'invited-subject');
          assert.equal(authenticated[0]?.assurance_level, 'GOOGLE_ONLY');
          invitedAdminId = authenticated[0].platform_admin_id;
          invitedSessionId = authenticated[0].session_id;

          await accessService.invite(
            session,
            { displayName: 'Outro Convite', email: 'outro@example.test' },
            randomUUID(),
          );
          await assert.rejects(
            googleLogin('outro@example.test', 'invited-subject'),
            hasDatabaseMessage('PLATFORM_ADMIN_ACCESS_DENIED'),
          );
          const [otherInvitation] = await admin.query<{ status: string }>(
            "SELECT status FROM metas.platform_admin_invitations WHERE email='outro@example.test'",
            { type: QueryTypes.SELECT },
          );
          assert.equal(otherInvitation?.status, 'PENDING');

          await admin.query(
            `INSERT INTO metas.platform_admin_invitations(
              display_name,email,status,expires_at,created_at,created_by_platform_admin_id
            ) VALUES(
              'Expirada','expirada@example.test','EXPIRED',now()-interval '1 day',
              now()-interval '2 days',:adminId
            )`,
            { replacements: { adminId } },
          );
          await assert.rejects(
            googleLogin('expirada@example.test', 'expired-subject'),
            hasDatabaseMessage('PLATFORM_ADMIN_ACCESS_DENIED'),
          );

          await assert.rejects(
            new PostgresManagementService(runtime).list(
              {
                assuranceLevel: 'GOOGLE_ONLY',
                expiresAt: '',
                mfaVerifiedAt: null,
                platformAdminId: invitedAdminId,
                sessionId: invitedSessionId,
                stepUpVerifiedAt: null,
              },
              'pharmacies',
              listInputSchema.parse({}),
            ),
            { code: 'MANAGEMENT_MFA_REQUIRED' },
          );
          const [acceptedAudit] = await admin.query<{ total: string }>(
            "SELECT count(*)::TEXT total FROM metas.platform_admin_audit_events WHERE action='PLATFORM_ADMIN_INVITATION_ACCEPTED'",
            { type: QueryTypes.SELECT },
          );
          assert.equal(acceptedAudit?.total, '1');
        },
      );

      await t.test(
        'outro administrador com step-up aprova o primeiro dispositivo por prazo curto e o próprio alvo não pode aprovar',
        async () => {
          const [requested] = await withPlatformAdminDatabaseContext(
            runtime,
            { platformAdminId: invitedAdminId, sessionId: invitedSessionId },
            (transaction) =>
              runtime.query<{ enrollment_request_id: string }>(
                `SELECT * FROM metas.request_platform_admin_first_enrollment(
                  CURRENT_TIMESTAMP + interval '10 minutes',CAST(:requestId AS UUID),NULL,NULL
                )`,
                { replacements: { requestId: randomUUID() }, transaction, type: QueryTypes.SELECT },
              ),
          );
          assert.ok(requested?.enrollment_request_id);
          const invitedIdentity = (
            await admin.query<{ id: string }>(
              'SELECT id FROM metas.platform_admin_identities WHERE platform_admin_id=:adminId',
              { replacements: { adminId: invitedAdminId }, type: QueryTypes.SELECT },
            )
          )[0]!.id;
          const syntheticMfaSession = randomUUID();
          await admin.query(
            `INSERT INTO metas.platform_admin_sessions(
              id,platform_admin_id,identity_id,token_hash,assurance_level,mfa_verified_at,
              step_up_verified_at,expires_at,idle_expires_at
            ) VALUES(
              :sessionId,:adminId,:identityId,:tokenHash,'MFA_VERIFIED',now(),now(),
              now()+interval '1 hour',now()+interval '30 minutes'
            )`,
            {
              replacements: {
                adminId: invitedAdminId,
                identityId: invitedIdentity,
                sessionId: syntheticMfaSession,
                tokenHash: randomBytes(32),
              },
            },
          );
          await assert.rejects(
            withPlatformAdminDatabaseContext(
              runtime,
              { platformAdminId: invitedAdminId, sessionId: syntheticMfaSession },
              (transaction) =>
                runtime.query(
                  `SELECT metas.approve_platform_admin_first_enrollment_by_admin(
                    CAST(:enrollmentId AS UUID),CURRENT_TIMESTAMP+interval '5 minutes',
                    CURRENT_TIMESTAMP-interval '5 minutes',CAST(:requestId AS UUID)
                  )`,
                  {
                    replacements: {
                      enrollmentId: requested.enrollment_request_id,
                      requestId: randomUUID(),
                    },
                    transaction,
                  },
                ),
            ),
            hasDatabaseMessage('PLATFORM_ADMIN_SELF_APPROVAL_FORBIDDEN'),
          );

          await accessService.approveFirstEnrollment(
            session,
            requested.enrollment_request_id,
            randomUUID(),
          );
          const [approval] = await admin.query<{
            approved_by_platform_admin_id: string;
            status: string;
            ttl_seconds: number;
          }>(
            `SELECT status,approved_by_platform_admin_id,
              extract(epoch FROM approval_expires_at-now())::INTEGER ttl_seconds
             FROM metas.platform_admin_first_enrollment_requests WHERE id=:id`,
            { replacements: { id: requested.enrollment_request_id }, type: QueryTypes.SELECT },
          );
          assert.equal(approval?.status, 'APPROVED');
          assert.equal(approval?.approved_by_platform_admin_id, adminId);
          assert.ok((approval?.ttl_seconds ?? 0) > 0 && (approval?.ttl_seconds ?? 0) <= 300);
        },
      );
      await t.test(
        'runtime sem acesso direto, operator sem EXECUTE, contexto ausente e Google-only bloqueados no banco',
        async () => {
          for (const sql of [
            "SELECT metas.read_platform_directory(NULL,'{}'::jsonb)",
            "SELECT metas.read_platform_directory('pharmacies',NULL)",
            "SELECT metas.write_platform_directory(NULL,NULL,'{}'::jsonb,gen_random_uuid())",
            'SELECT metas.delete_platform_employee(NULL,NULL,NULL,NULL,NULL)',
          ]) {
            await assert.rejects(
              withPlatformAdminDatabaseContext(
                runtime,
                { platformAdminId: adminId, sessionId },
                (transaction) => runtime.query(sql, { transaction }),
              ),
              (error: unknown) =>
                error instanceof Error &&
                'parent' in error &&
                error.parent instanceof Error &&
                error.parent.message === 'MANAGEMENT_INVALID_INPUT',
            );
          }
          await assert.rejects(runtime.query('SELECT * FROM metas.users'));
          await assert.rejects(runtime.query('SELECT * FROM metas.platform_admin_invitations'));
          await assert.rejects(
            connect('metas_platform_admin_operator').query(
              "SELECT metas.read_platform_directory('pharmacies','{}'::jsonb)",
            ),
          );
          await assert.rejects(
            connect('metas_platform_admin_operator').query(
              'SELECT metas.read_platform_admin_access()',
            ),
          );
          const [privileges] = await admin.query<{
            app_runtime: boolean;
            app_runtime_create: boolean;
            app_runtime_delete: boolean;
            operator_create: boolean;
            operator_delete: boolean;
            platform_runtime: boolean;
            platform_runtime_create: boolean;
            platform_runtime_delete: boolean;
            public_role: boolean;
            public_create: boolean;
            public_delete: boolean;
          }>(
            `SELECT
              has_function_privilege('metas_app_runtime','metas.read_platform_admin_access()','EXECUTE') app_runtime,
              has_function_privilege('metas_app_runtime','metas.create_platform_employee(text,citext,uuid,text,timestamptz,uuid)','EXECUTE') app_runtime_create,
              has_function_privilege('metas_app_runtime','metas.delete_platform_employee(uuid,integer,integer,timestamptz,uuid)','EXECUTE') app_runtime_delete,
              has_function_privilege('metas_platform_admin_operator','metas.create_platform_employee(text,citext,uuid,text,timestamptz,uuid)','EXECUTE') operator_create,
              has_function_privilege('metas_platform_admin_operator','metas.delete_platform_employee(uuid,integer,integer,timestamptz,uuid)','EXECUTE') operator_delete,
              has_function_privilege('metas_platform_admin_runtime','metas.read_platform_admin_access()','EXECUTE') platform_runtime,
              has_function_privilege('metas_platform_admin_runtime','metas.create_platform_employee(text,citext,uuid,text,timestamptz,uuid)','EXECUTE') platform_runtime_create,
              has_function_privilege('metas_platform_admin_runtime','metas.delete_platform_employee(uuid,integer,integer,timestamptz,uuid)','EXECUTE') platform_runtime_delete,
              has_function_privilege('public','metas.read_platform_admin_access()','EXECUTE') public_role,
              has_function_privilege('public','metas.create_platform_employee(text,citext,uuid,text,timestamptz,uuid)','EXECUTE') public_create,
              has_function_privilege('public','metas.delete_platform_employee(uuid,integer,integer,timestamptz,uuid)','EXECUTE') public_delete`,
            { type: QueryTypes.SELECT },
          );
          assert.deepEqual(privileges, {
            app_runtime: false,
            app_runtime_create: false,
            app_runtime_delete: false,
            operator_create: false,
            operator_delete: false,
            platform_runtime: true,
            platform_runtime_create: true,
            platform_runtime_delete: true,
            public_role: false,
            public_create: false,
            public_delete: false,
          });
          const [functionSecurity] = await admin.query<{
            fixed_search_path: boolean;
            owner_name: string;
            security_definer: boolean;
          }>(
            `SELECT
              pg_get_userbyid(proowner) owner_name,
              prosecdef security_definer,
              COALESCE(proconfig,ARRAY[]::TEXT[]) @> ARRAY['search_path=pg_catalog'] fixed_search_path
             FROM pg_proc procedure
             JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
             WHERE namespace.nspname='metas' AND procedure.proname='create_platform_employee'`,
            { type: QueryTypes.SELECT },
          );
          assert.deepEqual(functionSecurity, {
            fixed_search_path: true,
            owner_name: 'metas_migration_owner',
            security_definer: true,
          });
          const [deleteFunctionSecurity] = await admin.query<{
            fixed_search_path: boolean;
            owner_name: string;
            security_definer: boolean;
          }>(
            `SELECT
              pg_get_userbyid(proowner) owner_name,
              prosecdef security_definer,
              COALESCE(proconfig,ARRAY[]::TEXT[]) @> ARRAY['search_path=pg_catalog'] fixed_search_path
             FROM pg_proc procedure
             JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
             WHERE namespace.nspname='metas' AND procedure.proname='delete_platform_employee'`,
            { type: QueryTypes.SELECT },
          );
          assert.deepEqual(deleteFunctionSecurity, {
            fixed_search_path: true,
            owner_name: 'metas_migration_owner',
            security_definer: true,
          });
          await assert.rejects(
            runtime.query("SELECT metas.read_platform_directory('pharmacies','{}'::jsonb)"),
          );
          await admin.query(
            "UPDATE metas.platform_admin_sessions SET assurance_level='GOOGLE_ONLY',mfa_verified_at=NULL,step_up_verified_at=NULL WHERE id=:id",
            { replacements: { id: sessionId } },
          );
          await assert.rejects(service.list(session, 'pharmacies', listInputSchema.parse({})), {
            code: 'MANAGEMENT_MFA_REQUIRED',
          });
          await assert.rejects(accessService.list(session), { code: 'MANAGEMENT_MFA_REQUIRED' });
          await assert.rejects(
            withPlatformAdminDatabaseContext(
              runtime,
              { platformAdminId: adminId, sessionId },
              (transaction) =>
                runtime.query(
                  "SELECT metas.write_platform_directory('savePharmacy',NULL,'{}'::jsonb,:requestId)",
                  { replacements: { requestId: randomUUID() }, transaction },
                ),
            ),
          );
        },
      );
    } finally {
      await Promise.all(connections.map((db) => db.close()));
      if (started)
        await execute(path.join(binaries, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop'], {
          windowsHide: true,
        });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
