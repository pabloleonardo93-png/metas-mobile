import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import type { PlatformAdminSession } from '../src/modules/platformAdmin/platformAdmin.types.js';
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
      code === 0 ? resolve() : reject(new Error('LOCAL_POSTGRES_PROCESS_FAILED')),
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
      INSERT INTO metas.platform_admin_sessions(id,platform_admin_id,identity_id,token_hash,assurance_level,mfa_verified_at,expires_at,idle_expires_at)
        VALUES (:sessionId,:adminId,:identityId,decode(repeat('ab',32),'hex'),'MFA_VERIFIED',now(),now()+interval '1 hour',now()+interval '30 minutes');
    `,
        { replacements: { adminId, identityId, sessionId } },
      );
      const runtime = connect('metas_platform_admin_runtime');
      const service = new PostgresManagementService(runtime);
      const session: PlatformAdminSession = {
        platformAdminId: adminId,
        sessionId,
        assuranceLevel: 'MFA_VERIFIED',
        expiresAt: '',
        mfaVerifiedAt: '',
        stepUpVerifiedAt: null,
      };
      const write = (
        operation: 'savePharmacy' | 'updateEmployee' | 'linkEmployee',
        id: string | null,
        input: unknown,
      ) => service.write(session, operation, id, input, randomUUID());
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
        'runtime sem acesso direto, operator sem EXECUTE, contexto ausente e Google-only bloqueados no banco',
        async () => {
          for (const sql of [
            "SELECT metas.read_platform_directory(NULL,'{}'::jsonb)",
            "SELECT metas.read_platform_directory('pharmacies',NULL)",
            "SELECT metas.write_platform_directory(NULL,NULL,'{}'::jsonb,gen_random_uuid())",
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
          await assert.rejects(
            connect('metas_platform_admin_operator').query(
              "SELECT metas.read_platform_directory('pharmacies','{}'::jsonb)",
            ),
          );
          await assert.rejects(
            runtime.query("SELECT metas.read_platform_directory('pharmacies','{}'::jsonb)"),
          );
          await admin.query(
            "UPDATE metas.platform_admin_sessions SET assurance_level='GOOGLE_ONLY',mfa_verified_at=NULL WHERE id=:id",
            { replacements: { id: sessionId } },
          );
          await assert.rejects(service.list(session, 'pharmacies', listInputSchema.parse({})), {
            code: 'MANAGEMENT_MFA_REQUIRED',
          });
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
