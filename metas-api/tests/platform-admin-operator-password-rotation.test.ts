import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { Sequelize, Transaction } from 'sequelize';

import type { DatabaseConnectionParameters } from '../src/config/database.js';
import type { NorthflankAdminDatabaseEnv } from '../src/config/env.js';
import {
  parsePlatformAdminOperatorPassword,
  platformAdminOperatorRoleName,
  runPlatformAdminOperatorPasswordRotation,
} from '../src/database/admin/platformAdminOperatorPasswordRotation.js';
import type { LogContext, Logger } from '../src/shared/logging/logger.js';

const execFileAsync = promisify(execFile);
const testPassword = "synthetic-operator-password-'safe";

class RecordingLogger implements Logger {
  readonly entries: Array<{ context?: LogContext; event: string; level: 'error' | 'info' }> = [];

  error(event: string, context?: LogContext): void {
    this.entries.push({ ...(context ? { context } : {}), event, level: 'error' });
  }

  info(event: string, context?: LogContext): void {
    this.entries.push({ ...(context ? { context } : {}), event, level: 'info' });
  }
}

interface FakeDatabaseOptions {
  authenticateError?: Error;
  closeError?: Error;
  currentUser?: string;
  role?: { canLogin: boolean; isSuperuser: boolean } | null;
  rotationError?: Error;
}

class FakeDatabase {
  readonly calls: string[] = [];
  readonly queries: Array<{ bind?: unknown; sql: string }> = [];

  constructor(private readonly options: FakeDatabaseOptions = {}) {}

  authenticate(): Promise<void> {
    this.calls.push('authenticate');
    if (this.options.authenticateError) {
      throw this.options.authenticateError;
    }
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.calls.push('close');
    if (this.options.closeError) {
      throw this.options.closeError;
    }
    return Promise.resolve();
  }

  query(sql: string, options: { bind?: Record<string, string> } = {}): Promise<unknown[]> {
    this.queries.push({ bind: options.bind, sql });
    if (sql.includes('FROM pg_roles')) {
      return Promise.resolve(
        this.options.role === null
          ? []
          : [this.options.role ?? { canLogin: true, isSuperuser: false }],
      );
    }
    if (sql.includes('quote_literal')) {
      const password = options.bind?.password ?? '';
      return Promise.resolve([{ passwordLiteral: `'${password.replaceAll("'", "''")}'` }]);
    }
    if (sql.startsWith('ALTER ROLE')) {
      if (this.options.rotationError) {
        throw this.options.rotationError;
      }
      return Promise.resolve([]);
    }
    if (sql.includes('current_user')) {
      return Promise.resolve([
        { currentUser: this.options.currentUser ?? platformAdminOperatorRoleName },
      ]);
    }
    throw new Error('Unexpected synthetic query');
  }

  transaction<T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    return callback({} as Transaction);
  }

  asSequelize(): Sequelize {
    return this as unknown as Sequelize;
  }
}

const adminConfiguration: NorthflankAdminDatabaseEnv = {
  database: 'metas_test',
  host: 'postgres.example.test',
  password: 'synthetic-admin-password',
  port: 5432,
  sslServerName: 'postgres.example.test',
  username: 'synthetic_admin',
};

const runRotation = async (
  options: {
    admin?: FakeDatabase;
    loadConfiguration?: () => {
      adminDatabase: NorthflankAdminDatabaseEnv;
      operatorPassword: string;
    };
    operator?: FakeDatabase;
    policyError?: Error;
  } = {},
): Promise<{
  admin: FakeDatabase;
  connections: DatabaseConnectionParameters[];
  exitCode: number;
  logger: RecordingLogger;
  operator: FakeDatabase;
  policyDatabases: Sequelize[];
}> => {
  const admin = options.admin ?? new FakeDatabase();
  const operator = options.operator ?? new FakeDatabase();
  const connections: DatabaseConnectionParameters[] = [];
  const policyDatabases: Sequelize[] = [];
  const logger = new RecordingLogger();
  const exitCode = await runPlatformAdminOperatorPasswordRotation({
    assertOperatorConnectionSecurity: (database) => {
      policyDatabases.push(database);
      return options.policyError ? Promise.reject(options.policyError) : Promise.resolve();
    },
    createDatabase: (parameters) => {
      connections.push(parameters);
      return connections.length === 1 ? admin.asSequelize() : operator.asSequelize();
    },
    disconnectDatabase: async (database) => {
      await database.close();
    },
    loadConfiguration:
      options.loadConfiguration ??
      (() => ({ adminDatabase: adminConfiguration, operatorPassword: testPassword })),
    logger,
  });
  return { admin, connections, exitCode, logger, operator, policyDatabases };
};

await test('dedicated operator password is required without a default', () => {
  assert.throws(() => parsePlatformAdminOperatorPassword({}), /INVALID_CONFIGURATION/u);
  assert.throws(
    () => parsePlatformAdminOperatorPassword({ PLATFORM_ADMIN_OPERATOR_DB_PASSWORD: '' }),
    /INVALID_CONFIGURATION/u,
  );
  assert.throws(
    () => parsePlatformAdminOperatorPassword({ PLATFORM_ADMIN_OPERATOR_DB_PASSWORD: '   ' }),
    /INVALID_CONFIGURATION/u,
  );
  assert.equal(
    parsePlatformAdminOperatorPassword({
      NORTHFLANK_ADMIN_DB_PASSWORD: 'must-not-be-used',
      NORTHFLANK_MIGRATION_DB_PASSWORD: 'must-not-be-used',
      NORTHFLANK_PLATFORM_ADMIN_OPERATOR_DB_PASSWORD: 'must-not-be-used',
      PLATFORM_ADMIN_OPERATOR_DB_PASSWORD: testPassword,
      PLATFORM_ADMIN_RUNTIME_DB_PASSWORD: 'must-not-be-used',
    }),
    testPassword,
  );
});

await test('missing role fails without creating, granting, or revoking a role', async () => {
  const result = await runRotation({ admin: new FakeDatabase({ role: null }) });
  const sql = result.admin.queries.map(({ sql: query }) => query).join('\n');

  assert.equal(result.exitCode, 1);
  assert.equal(result.logger.entries.at(-1)?.context?.code, 'ROLE_NOT_FOUND');
  assert.doesNotMatch(sql, /CREATE ROLE|GRANT|REVOKE/iu);
  assert.equal(result.connections.length, 1);
});

await test('role validation requires LOGIN and rejects SUPERUSER without changing flags', async () => {
  for (const role of [
    { canLogin: false, isSuperuser: false },
    { canLogin: true, isSuperuser: true },
  ]) {
    const result = await runRotation({ admin: new FakeDatabase({ role }) });
    const mutatingSql = result.admin.queries
      .map(({ sql }) => sql)
      .filter((sql) => !sql.trimStart().startsWith('SELECT'))
      .join('\n');

    assert.equal(result.exitCode, 1);
    assert.equal(result.logger.entries.at(-1)?.context?.code, 'ROLE_CONFIGURATION_INVALID');
    assert.doesNotMatch(
      mutatingSql,
      /NOLOGIN|SUPERUSER|CREATEDB|CREATEROLE|BYPASSRLS|REPLICATION|INHERIT|GRANT|REVOKE/iu,
    );
  }
});

await test('rotation safely quotes the password and changes only PASSWORD on the fixed operator', async () => {
  const result = await runRotation();
  const quoteQuery = result.admin.queries.find(({ sql }) => sql.includes('quote_literal'));
  const alterQuery = result.admin.queries.find(({ sql }) => sql.startsWith('ALTER ROLE'));

  assert.equal(result.exitCode, 0);
  assert.deepEqual(quoteQuery?.bind, { password: testPassword });
  assert.match(
    alterQuery?.sql ?? '',
    /^ALTER ROLE "metas_platform_admin_operator" PASSWORD '[^;]+'$/u,
  );
  assert.doesNotMatch(
    alterQuery?.sql ?? '',
    /metas_platform_admin_runtime|metas_migration_runner|synthetic_admin|LOGIN|SUPERUSER|CREATEDB|CREATEROLE|BYPASSRLS|REPLICATION|INHERIT|GRANT|REVOKE/iu,
  );
});

await test('verification uses the new password, requires operator identity, and checks policy', async () => {
  const result = await runRotation();

  assert.equal(result.exitCode, 0);
  assert.equal(result.connections[1]?.username, 'metas_platform_admin_operator');
  assert.equal(result.connections[1]?.password, testPassword);
  assert.deepEqual(result.operator.calls, ['authenticate', 'close']);
  assert.equal(
    result.operator.queries.some(({ sql }) => sql === 'SELECT current_user::TEXT AS "currentUser"'),
    true,
  );
  assert.deepEqual(result.policyDatabases, [result.operator.asSequelize()]);
});

await test('unexpected current_user fails and closes both connections', async () => {
  const result = await runRotation({
    operator: new FakeDatabase({ currentUser: 'metas_platform_admin_runtime' }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.logger.entries.at(-1)?.context?.code, 'UNEXPECTED_OPERATOR_IDENTITY');
  assert.equal(result.admin.calls.at(-1), 'close');
  assert.equal(result.operator.calls.at(-1), 'close');
  assert.equal(result.policyDatabases.length, 0);
});

await test('operator policy failure aborts with a sanitized code', async () => {
  const result = await runRotation({ policyError: new Error(testPassword) });

  assert.equal(result.exitCode, 1);
  assert.equal(result.logger.entries.at(-1)?.context?.code, 'OPERATOR_SECURITY_VALIDATION_FAILED');
  assert.doesNotMatch(JSON.stringify(result.logger.entries), /synthetic-operator-password/u);
  assert.equal(result.admin.calls.at(-1), 'close');
  assert.equal(result.operator.calls.at(-1), 'close');
});

await test('login and rotation errors never expose the supplied password', async () => {
  for (const options of [
    { operator: new FakeDatabase({ authenticateError: new Error(testPassword) }) },
    { admin: new FakeDatabase({ rotationError: new Error(testPassword) }) },
  ]) {
    const result = await runRotation(options);
    assert.equal(result.exitCode, 1);
    assert.doesNotMatch(JSON.stringify(result.logger.entries), /synthetic-operator-password/u);
    assert.equal(result.admin.calls.at(-1), 'close');
  }
});

await test('success logs only fixed role and verification metadata', async () => {
  const result = await runRotation();
  const serialized = JSON.stringify(result.logger.entries);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.logger.entries.at(-1), {
    context: {
      roleName: 'metas_platform_admin_operator',
      verificationStatus: 'verified',
    },
    event: 'platform_admin_operator_password_rotation_succeeded',
    level: 'info',
  });
  assert.doesNotMatch(serialized, /synthetic-operator-password|postgres\.example\.test/iu);
});

await test('package script targets the dedicated operator entrypoint', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };

  assert.equal(
    packageJson.scripts['db:admin:operator-password:rotate:northflank'],
    'tsx src/database/admin/rotatePlatformAdminOperatorPassword.ts',
  );
});

await test('importing the CLI entrypoint has no operational side effects', async () => {
  const entrypointUrl = new URL(
    '../src/database/admin/rotatePlatformAdminOperatorPassword.ts',
    import.meta.url,
  ).href;
  const probe = [
    'const initialExitCode = process.exitCode;',
    `await import(${JSON.stringify(entrypointUrl)});`,
    'await new Promise((resolve) => setImmediate(resolve));',
    "if (process.exitCode !== initialExitCode) throw new Error('PROCESS_EXIT_CODE_CHANGED');",
  ].join('\n');

  const result = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', probe],
    {
      cwd: process.cwd(),
      env: { NODE_ENV: 'test' },
      windowsHide: true,
    },
  );

  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

await test('direct CLI execution runs and fails safely without configuration', async () => {
  const entrypointPath = fileURLToPath(
    new URL('../src/database/admin/rotatePlatformAdminOperatorPassword.ts', import.meta.url),
  );
  const result = await execFileAsync(process.execPath, ['--import', 'tsx', entrypointPath], {
    cwd: process.cwd(),
    env: {
      NODE_ENV: 'test',
      NORTHFLANK_ADMIN_DB_HOST: '',
      NORTHFLANK_ADMIN_DB_NAME: '',
      NORTHFLANK_ADMIN_DB_PASSWORD: '',
      NORTHFLANK_ADMIN_DB_PORT: '',
      NORTHFLANK_ADMIN_DB_USER: '',
      NORTHFLANK_DATABASE_SSL: '',
      PLATFORM_ADMIN_OPERATOR_DB_PASSWORD: '',
      SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    },
    windowsHide: true,
  }).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'stdout' in error && 'stderr' in error) {
      return {
        stderr: String(error.stderr),
        stdout: String(error.stdout),
      };
    }
    throw error;
  });

  assert.equal(result.stdout, '');
  const output = JSON.parse(result.stderr.trim()) as { code?: string; event?: string };
  assert.equal(output.event, 'platform_admin_operator_password_rotation_failed');
  assert.equal(output.code, 'INVALID_CONFIGURATION');
});
