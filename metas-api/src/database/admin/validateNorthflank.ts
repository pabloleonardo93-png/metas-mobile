import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { createDatabaseFromParameters, disconnectDatabase } from '../../config/database.js';
import { loadNorthflankAdminDatabaseEnv } from '../../config/env.js';
import { logger } from '../../shared/logging/logger.js';

const runNpmScript = (script: string, environment: NodeJS.ProcessEnv): void => {
  const allowedScripts = new Set([
    'db:admin:bootstrap:northflank',
    'db:migrate:northflank',
    'test:integration',
  ]);
  assert.ok(allowedScripts.has(script));
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const args =
    process.platform === 'win32' ? ['/d', '/s', '/c', `npm run ${script}`] : ['run', script];
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Northflank validation command failed: ${script}`);
  }
};

const validateNorthflank = async (): Promise<void> => {
  assert.notEqual(process.env.NODE_ENV, 'production');
  const temporaryDatabase = `metas_validation_${randomBytes(8).toString('hex')}`;
  assert.match(temporaryDatabase, /^metas_validation_[a-f0-9]{16}$/u);

  const env = loadNorthflankAdminDatabaseEnv();
  assert.notEqual(temporaryDatabase, env.database);
  const adminDatabase = createDatabaseFromParameters(
    {
      database: env.database,
      host: env.host,
      password: env.password,
      port: env.port,
      username: env.username,
    },
    env.sslServerName,
  );
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NORTHFLANK_ADMIN_DB_NAME: temporaryDatabase,
    NORTHFLANK_REMOTE_TEST: 'true',
  };

  try {
    await adminDatabase.query(`CREATE DATABASE "${temporaryDatabase}"`);
    logger.info('northflank_validation_database_created');

    runNpmScript('db:admin:bootstrap:northflank', childEnvironment);
    runNpmScript('db:migrate:northflank', childEnvironment);
    runNpmScript('test:integration', childEnvironment);
  } finally {
    await adminDatabase.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = :databaseName AND pid <> pg_backend_pid()`,
      { replacements: { databaseName: temporaryDatabase } },
    );
    await adminDatabase.query(`DROP DATABASE IF EXISTS "${temporaryDatabase}" WITH (FORCE)`);
    await disconnectDatabase(adminDatabase);
    logger.info('northflank_validation_database_removed');
  }
};

void validateNorthflank().catch((error: unknown) => {
  logger.error('northflank_validation_failed', {
    errorType: error instanceof Error ? error.name : 'UnknownError',
  });
  process.exitCode = 1;
});
