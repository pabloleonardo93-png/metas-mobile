import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import type { Sequelize, Transaction } from 'sequelize';

import type { DatabaseConnectionParameters } from '../src/config/database.js';
import type { NorthflankAdminDatabaseEnv } from '../src/config/env.js';
import {
  parsePlatformAdminRuntimePassword,
  platformAdminRuntimeRoleName,
  runPlatformAdminRuntimePasswordRotation,
} from '../src/database/admin/platformAdminRuntimePasswordRotation.js';
import type { LogContext, Logger } from '../src/shared/logging/logger.js';

const testPassword = "synthetic-runtime-password-'safe";

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
        { currentUser: this.options.currentUser ?? platformAdminRuntimeRoleName },
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
      runtimePassword: string;
    };
    runtime?: FakeDatabase;
  } = {},
): Promise<{
  admin: FakeDatabase;
  connections: DatabaseConnectionParameters[];
  exitCode: number;
  logger: RecordingLogger;
  runtime: FakeDatabase;
}> => {
  const admin = options.admin ?? new FakeDatabase();
  const runtime = options.runtime ?? new FakeDatabase();
  const connections: DatabaseConnectionParameters[] = [];
  const logger = new RecordingLogger();
  const exitCode = await runPlatformAdminRuntimePasswordRotation({
    createDatabase: (parameters) => {
      connections.push(parameters);
      return connections.length === 1 ? admin.asSequelize() : runtime.asSequelize();
    },
    disconnectDatabase: async (database) => {
      await database.close();
    },
    loadConfiguration:
      options.loadConfiguration ??
      (() => ({ adminDatabase: adminConfiguration, runtimePassword: testPassword })),
    logger,
  });
  return { admin, connections, exitCode, logger, runtime };
};

await test('dedicated runtime password is required without a default', () => {
  assert.throws(() => parsePlatformAdminRuntimePassword({}), /INVALID_CONFIGURATION/u);
  assert.throws(
    () => parsePlatformAdminRuntimePassword({ PLATFORM_ADMIN_RUNTIME_DB_PASSWORD: '' }),
    /INVALID_CONFIGURATION/u,
  );
  assert.throws(
    () => parsePlatformAdminRuntimePassword({ PLATFORM_ADMIN_RUNTIME_DB_PASSWORD: '   ' }),
    /INVALID_CONFIGURATION/u,
  );
  assert.equal(
    parsePlatformAdminRuntimePassword({ PLATFORM_ADMIN_RUNTIME_DB_PASSWORD: testPassword }),
    testPassword,
  );
});

await test('missing role fails without creating or granting a role', async () => {
  const result = await runRotation({ admin: new FakeDatabase({ role: null }) });
  const sql = result.admin.queries.map(({ sql: query }) => query).join('\n');

  assert.equal(result.exitCode, 1);
  assert.equal(result.logger.entries.at(-1)?.context?.code, 'ROLE_NOT_FOUND');
  assert.doesNotMatch(sql, /CREATE ROLE|GRANT|REVOKE/iu);
  assert.equal(result.connections.length, 1);
});

await test('role validation requires LOGIN and rejects SUPERUSER without changing attributes', async () => {
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

await test('rotation quotes the password through a bind and changes only PASSWORD on the fixed role', async () => {
  const result = await runRotation();
  const quoteQuery = result.admin.queries.find(({ sql }) => sql.includes('quote_literal'));
  const alterQuery = result.admin.queries.find(({ sql }) => sql.startsWith('ALTER ROLE'));

  assert.equal(result.exitCode, 0);
  assert.deepEqual(quoteQuery?.bind, { password: testPassword });
  assert.match(
    alterQuery?.sql ?? '',
    /^ALTER ROLE "metas_platform_admin_runtime" PASSWORD '[^;]+'$/u,
  );
  assert.doesNotMatch(
    alterQuery?.sql ?? '',
    /LOGIN|SUPERUSER|CREATEDB|CREATEROLE|BYPASSRLS|REPLICATION|INHERIT|GRANT|REVOKE/iu,
  );
});

await test('verification connects with the fixed runtime role and requires current_user', async () => {
  const result = await runRotation();

  assert.equal(result.exitCode, 0);
  assert.equal(result.connections[1]?.username, 'metas_platform_admin_runtime');
  assert.equal(result.connections[1]?.password, testPassword);
  assert.deepEqual(result.runtime.calls, ['authenticate', 'close']);
  assert.equal(
    result.runtime.queries.some(({ sql }) => sql === 'SELECT current_user::TEXT AS "currentUser"'),
    true,
  );
});

await test('unexpected current_user fails verification and closes both connections', async () => {
  const result = await runRotation({
    runtime: new FakeDatabase({ currentUser: 'metas_app_runtime' }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.logger.entries.at(-1)?.context?.code, 'UNEXPECTED_RUNTIME_IDENTITY');
  assert.equal(result.admin.calls.at(-1), 'close');
  assert.equal(result.runtime.calls.at(-1), 'close');
});

await test('runtime authentication failure is sanitized and closes both connections', async () => {
  const result = await runRotation({
    runtime: new FakeDatabase({ authenticateError: new Error(testPassword) }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.logger.entries.at(-1)?.context?.code, 'LOGIN_VERIFICATION_FAILED');
  assert.equal(result.admin.calls.at(-1), 'close');
  assert.equal(result.runtime.calls.at(-1), 'close');
  assert.doesNotMatch(JSON.stringify(result.logger.entries), /synthetic-runtime-password/u);
});

await test('rotation failure is sanitized and does not attempt repeated rotation', async () => {
  const result = await runRotation({
    admin: new FakeDatabase({ rotationError: new Error(testPassword) }),
  });
  const alters = result.admin.queries.filter(({ sql }) => sql.startsWith('ALTER ROLE'));

  assert.equal(result.exitCode, 1);
  assert.equal(result.logger.entries.at(-1)?.context?.code, 'PASSWORD_ROTATION_FAILED');
  assert.equal(alters.length, 1);
  assert.equal(result.connections.length, 1);
  assert.doesNotMatch(JSON.stringify(result.logger.entries), /synthetic-runtime-password/u);
});

await test('invalid configuration creates no connection and never logs the secret', async () => {
  const result = await runRotation({
    loadConfiguration: () => {
      throw new Error(testPassword);
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.connections.length, 0);
  assert.equal(result.logger.entries.at(-1)?.context?.code, 'INVALID_CONFIGURATION');
  assert.doesNotMatch(JSON.stringify(result.logger.entries), /synthetic-runtime-password/u);
});

await test('cleanup failures return a sanitized failure', async () => {
  const result = await runRotation({
    runtime: new FakeDatabase({ closeError: new Error(testPassword) }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.logger.entries.at(-1)?.context?.code, 'CLEANUP_FAILED');
  assert.equal(result.admin.calls.at(-1), 'close');
  assert.equal(result.runtime.calls.at(-1), 'close');
  assert.doesNotMatch(JSON.stringify(result.logger.entries), /synthetic-runtime-password/u);
});

await test('package script targets the dedicated Northflank entrypoint', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };

  assert.equal(
    packageJson.scripts['db:admin:runtime-password:rotate:northflank'],
    'tsx src/database/admin/rotatePlatformAdminRuntimePassword.ts',
  );
});
