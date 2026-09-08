import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { isPlatformAdminDatabaseUrlValid } from '../src/config/env.js';
import {
  buildPlatformAdminRuntimeDatabaseUrl,
  parsePlatformAdminRuntimeDatabaseUrlConfiguration,
  platformAdminRuntimeDatabaseUser,
  platformAdminRuntimeDatabaseUrlTemporaryFile,
  removePlatformAdminRuntimeDatabaseUrlTemporaryFile,
  runPlatformAdminRuntimeDatabaseUrlPreparation,
  type PlatformAdminRuntimeDatabaseUrlError,
} from '../src/database/admin/platformAdminRuntimeDatabaseUrlPreparation.js';
import type { LogContext, Logger } from '../src/shared/logging/logger.js';

const runtimePassword = "synthetic runtime p@ssword:/?#[]!'";
const validEnvironment = {
  NORTHFLANK_ADMIN_DB_HOST: 'database.example.test',
  NORTHFLANK_ADMIN_DB_NAME: 'metas admin/database',
  NORTHFLANK_ADMIN_DB_PASSWORD: 'must-not-be-used',
  NORTHFLANK_ADMIN_DB_PORT: '5432',
  NORTHFLANK_ADMIN_DB_USER: 'must_not_be_used',
  NORTHFLANK_DATABASE_SSL: 'true',
  PLATFORM_ADMIN_RUNTIME_DB_PASSWORD: runtimePassword,
} satisfies NodeJS.ProcessEnv;

class RecordingLogger implements Logger {
  readonly entries: Array<{ context?: LogContext; event: string }> = [];

  error(event: string, context?: LogContext): void {
    this.entries.push({ ...(context ? { context } : {}), event });
  }

  info(event: string, context?: LogContext): void {
    this.entries.push({ ...(context ? { context } : {}), event });
  }
}

const assertFailureCode = (
  environment: NodeJS.ProcessEnv,
  code: PlatformAdminRuntimeDatabaseUrlError['code'],
): void => {
  assert.throws(
    () => parsePlatformAdminRuntimeDatabaseUrlConfiguration(environment),
    (error: PlatformAdminRuntimeDatabaseUrlError) => error.code === code,
  );
};

await test('required runtime URL inputs fail with sanitized codes', () => {
  assertFailureCode(
    { ...validEnvironment, NORTHFLANK_ADMIN_DB_HOST: '' },
    'INVALID_RUNTIME_DB_HOST',
  );
  assertFailureCode(
    { ...validEnvironment, NORTHFLANK_ADMIN_DB_PORT: '70000' },
    'INVALID_RUNTIME_DB_PORT',
  );
  assertFailureCode(
    { ...validEnvironment, NORTHFLANK_ADMIN_DB_NAME: '' },
    'INVALID_RUNTIME_DB_NAME',
  );
  assertFailureCode(
    { ...validEnvironment, PLATFORM_ADMIN_RUNTIME_DB_PASSWORD: '' },
    'MISSING_RUNTIME_DB_PASSWORD',
  );
});

await test('URL uses the fixed role and safely encodes password and database', () => {
  const configuration = parsePlatformAdminRuntimeDatabaseUrlConfiguration(validEnvironment);
  const databaseUrl = buildPlatformAdminRuntimeDatabaseUrl(configuration);
  const parsed = new URL(databaseUrl);

  assert.equal(decodeURIComponent(parsed.username), 'metas_platform_admin_runtime');
  assert.equal(decodeURIComponent(parsed.password), runtimePassword);
  assert.equal(decodeURIComponent(parsed.pathname.slice(1)), 'metas admin/database');
  assert.equal(platformAdminRuntimeDatabaseUser, 'metas_platform_admin_runtime');
  assert.notEqual(
    decodeURIComponent(parsed.password),
    validEnvironment.NORTHFLANK_ADMIN_DB_PASSWORD,
  );
  assert.notEqual(decodeURIComponent(parsed.username), validEnvironment.NORTHFLANK_ADMIN_DB_USER);
  assert.equal(isPlatformAdminDatabaseUrlValid(databaseUrl), true);
  assert.equal(isPlatformAdminDatabaseUrlValid('mysql://invalid.example.test/metas'), false);
});

await test('validation-only mode logs no URL, host, database, or password', async () => {
  const logger = new RecordingLogger();
  const exitCode = await runPlatformAdminRuntimeDatabaseUrlPreparation({
    arguments: [],
    environment: validEnvironment,
    logger,
    outputDirectory: process.cwd(),
  });

  assert.equal(exitCode, 0);
  const serialized = JSON.stringify(logger.entries);
  assert.doesNotMatch(
    serialized,
    /synthetic|database\.example|metas admin|postgresql:|must-not-be-used|must_not_be_used/iu,
  );
  assert.deepEqual(logger.entries[0]?.context, {
    databasePresent: true,
    hostPresent: true,
    platformAdminDatabaseUrlPrepared: true,
    portValid: true,
    roleName: 'metas_platform_admin_runtime',
    schemaValid: true,
  });
});

await test('failures log only a sanitized code', async () => {
  const logger = new RecordingLogger();
  const exitCode = await runPlatformAdminRuntimeDatabaseUrlPreparation({
    arguments: [],
    environment: {
      ...validEnvironment,
      NORTHFLANK_ADMIN_DB_HOST: `invalid/${runtimePassword}`,
    },
    logger,
    outputDirectory: process.cwd(),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(logger.entries[0], {
    context: {
      code: 'INVALID_RUNTIME_DB_HOST',
      roleName: 'metas_platform_admin_runtime',
    },
    event: 'platform_admin_runtime_database_url_preparation_failed',
  });
  assert.doesNotMatch(JSON.stringify(logger.entries), /synthetic|p@ssword/iu);
});

await test('temporary output is ignored, restricted where supported, and removable', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'metas-runtime-url-'));
  const logger = new RecordingLogger();
  try {
    const exitCode = await runPlatformAdminRuntimeDatabaseUrlPreparation({
      arguments: ['--write-temporary-file'],
      environment: validEnvironment,
      logger,
      outputDirectory,
    });
    assert.equal(exitCode, 0);

    const outputPath = join(outputDirectory, platformAdminRuntimeDatabaseUrlTemporaryFile);
    const content = await readFile(outputPath, 'utf8');
    assert.equal(isPlatformAdminDatabaseUrlValid(content), true);
    assert.equal(decodeURIComponent(new URL(content).password), runtimePassword);
    if (process.platform !== 'win32') {
      assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    }
    const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
    assert.match(gitignore, /^\*\.tmp$/mu);

    await removePlatformAdminRuntimeDatabaseUrlTemporaryFile(outputDirectory);
    await assert.rejects(readFile(outputPath, 'utf8'));
  } finally {
    await removePlatformAdminRuntimeDatabaseUrlTemporaryFile(outputDirectory);
  }
});

await test('package script targets the dedicated preparation entrypoint', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };
  assert.equal(
    packageJson.scripts['db:admin:runtime-url:prepare:northflank'],
    'tsx src/database/admin/preparePlatformAdminRuntimeDatabaseUrl.ts',
  );
});
