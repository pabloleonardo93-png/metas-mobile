import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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
const sourceDatabaseUrl =
  'postgresql://original_user:original_password@runtime-db.example.test:6543/metas%20production?sslmode=require&application_name=metas-api';
const execFileAsync = promisify(execFile);
const runtimeEnvironment = {
  DATABASE_URL: sourceDatabaseUrl,
  PLATFORM_ADMIN_RUNTIME_DB_PASSWORD: runtimePassword,
} satisfies NodeJS.ProcessEnv;
const environmentWithUnrelatedAdminEndpoint = {
  ...runtimeEnvironment,
  NORTHFLANK_ADMIN_DB_HOST: 'admin-job-db.example.test',
  NORTHFLANK_ADMIN_DB_NAME: 'admin_job_database',
  NORTHFLANK_ADMIN_DB_PASSWORD: 'must-not-be-used',
  NORTHFLANK_ADMIN_DB_PORT: '5432',
  NORTHFLANK_ADMIN_DB_USER: 'must_not_be_used',
  NORTHFLANK_DATABASE_SSL: 'false',
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

await test('runtime URL source and password fail with sanitized codes', () => {
  assertFailureCode(
    { PLATFORM_ADMIN_RUNTIME_DB_PASSWORD: runtimePassword },
    'MISSING_DATABASE_URL',
  );
  assertFailureCode(
    { ...runtimeEnvironment, DATABASE_URL: 'mysql://database.example.test/metas' },
    'INVALID_DATABASE_URL',
  );
  assertFailureCode(
    { ...runtimeEnvironment, DATABASE_URL: 'postgresql://[invalid' },
    'INVALID_DATABASE_URL',
  );
  assertFailureCode(
    { ...runtimeEnvironment, PLATFORM_ADMIN_RUNTIME_DB_PASSWORD: '' },
    'MISSING_RUNTIME_DB_PASSWORD',
  );
});

await test('generated URL preserves DATABASE_URL topology and replaces only credentials', () => {
  const configuration = parsePlatformAdminRuntimeDatabaseUrlConfiguration(runtimeEnvironment);
  const databaseUrl = buildPlatformAdminRuntimeDatabaseUrl(configuration);
  const source = new URL(sourceDatabaseUrl);
  const generated = new URL(databaseUrl);

  assert.equal(generated.protocol, source.protocol);
  assert.equal(generated.hostname, source.hostname);
  assert.equal(generated.port, source.port);
  assert.equal(generated.pathname, source.pathname);
  assert.equal(generated.search, source.search);
  assert.equal(decodeURIComponent(generated.username), 'metas_platform_admin_runtime');
  assert.equal(decodeURIComponent(generated.password), runtimePassword);
  assert.notEqual(generated.username, source.username);
  assert.notEqual(generated.password, source.password);
  assert.equal(platformAdminRuntimeDatabaseUser, 'metas_platform_admin_runtime');
  assert.equal(isPlatformAdminDatabaseUrlValid(databaseUrl), true);
});

await test('administrative endpoint and credentials do not influence the runtime URL', () => {
  const withoutAdministrativeValues = buildPlatformAdminRuntimeDatabaseUrl(
    parsePlatformAdminRuntimeDatabaseUrlConfiguration(runtimeEnvironment),
  );
  const withDifferentAdministrativeEndpoint = buildPlatformAdminRuntimeDatabaseUrl(
    parsePlatformAdminRuntimeDatabaseUrlConfiguration(environmentWithUnrelatedAdminEndpoint),
  );

  assert.equal(withDifferentAdministrativeEndpoint, withoutAdministrativeValues);
  const generated = new URL(withDifferentAdministrativeEndpoint);
  const source = new URL(sourceDatabaseUrl);
  assert.equal(generated.host, source.host);
  assert.equal(generated.pathname, source.pathname);
  assert.notEqual(
    generated.hostname,
    environmentWithUnrelatedAdminEndpoint.NORTHFLANK_ADMIN_DB_HOST,
  );
  assert.notEqual(generated.port, environmentWithUnrelatedAdminEndpoint.NORTHFLANK_ADMIN_DB_PORT);
  assert.notEqual(
    decodeURIComponent(generated.pathname.slice(1)),
    environmentWithUnrelatedAdminEndpoint.NORTHFLANK_ADMIN_DB_NAME,
  );
  assert.notEqual(
    decodeURIComponent(generated.username),
    environmentWithUnrelatedAdminEndpoint.NORTHFLANK_ADMIN_DB_USER,
  );
  assert.notEqual(
    decodeURIComponent(generated.password),
    environmentWithUnrelatedAdminEndpoint.NORTHFLANK_ADMIN_DB_PASSWORD,
  );
});

await test('IPv6 topology and existing query parameters are preserved', () => {
  const ipv6Source =
    'postgres://source:source@[2001:db8::1]:6432/metas?sslmode=require&application_name=admin%20runtime';
  const generated = new URL(
    buildPlatformAdminRuntimeDatabaseUrl(
      parsePlatformAdminRuntimeDatabaseUrlConfiguration({
        DATABASE_URL: ipv6Source,
        PLATFORM_ADMIN_RUNTIME_DB_PASSWORD: runtimePassword,
      }),
    ),
  );
  const source = new URL(ipv6Source);

  assert.equal(generated.hostname, source.hostname);
  assert.equal(generated.port, source.port);
  assert.equal(generated.pathname, source.pathname);
  assert.equal(generated.search, source.search);
  assert.equal(decodeURIComponent(generated.password), runtimePassword);
});

await test('validation-only mode logs no URL, topology, database, or password', async () => {
  const logger = new RecordingLogger();
  const exitCode = await runPlatformAdminRuntimeDatabaseUrlPreparation({
    arguments: [],
    environment: environmentWithUnrelatedAdminEndpoint,
    logger,
    outputDirectory: process.cwd(),
  });

  assert.equal(exitCode, 0);
  const serialized = JSON.stringify(logger.entries);
  assert.doesNotMatch(
    serialized,
    /synthetic|runtime-db|admin-job-db|metas%20production|original_user|original_password|sslmode|postgresql:|must-not-be-used|must_not_be_used/iu,
  );
  assert.deepEqual(logger.entries[0]?.context, {
    platformAdminDatabaseUrlPrepared: true,
    roleName: 'metas_platform_admin_runtime',
    schemaValid: true,
  });
});

await test('failures log only a sanitized code', async () => {
  const logger = new RecordingLogger();
  const exitCode = await runPlatformAdminRuntimeDatabaseUrlPreparation({
    arguments: [],
    environment: {
      ...runtimeEnvironment,
      DATABASE_URL: 'postgresql://',
    },
    logger,
    outputDirectory: process.cwd(),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(logger.entries[0], {
    context: {
      code: 'INVALID_DATABASE_URL',
      roleName: 'metas_platform_admin_runtime',
    },
    event: 'platform_admin_runtime_database_url_preparation_failed',
  });
  assert.doesNotMatch(JSON.stringify(logger.entries), /synthetic|p@ssword|postgresql:/iu);
});

await test('temporary output is ignored, restricted where supported, and removable', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'metas-runtime-url-'));
  const logger = new RecordingLogger();
  try {
    const exitCode = await runPlatformAdminRuntimeDatabaseUrlPreparation({
      arguments: ['--write-temporary-file'],
      environment: runtimeEnvironment,
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

await test('importing the CLI entrypoint has no operational side effects', async () => {
  const entrypointUrl = new URL(
    '../src/database/admin/preparePlatformAdminRuntimeDatabaseUrl.ts',
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
  await assert.rejects(
    readFile(join(process.cwd(), platformAdminRuntimeDatabaseUrlTemporaryFile), 'utf8'),
  );
});

await test('direct CLI execution still runs the preparation command', async () => {
  const entrypointPath = fileURLToPath(
    new URL('../src/database/admin/preparePlatformAdminRuntimeDatabaseUrl.ts', import.meta.url),
  );
  const result = await execFileAsync(process.execPath, ['--import', 'tsx', entrypointPath], {
    cwd: process.cwd(),
    env: { ...environmentWithUnrelatedAdminEndpoint, NODE_ENV: 'test' },
    windowsHide: true,
  });

  assert.equal(result.stderr, '');
  const serialized = result.stdout.trim();
  const parsedLog: unknown = JSON.parse(serialized);
  assert.ok(typeof parsedLog === 'object' && parsedLog !== null);
  assert.equal(Reflect.get(parsedLog, 'event'), 'platform_admin_runtime_database_url_prepared');
  assert.doesNotMatch(
    serialized,
    /synthetic|runtime-db|admin-job-db|metas%20production|original_user|original_password|sslmode|postgresql:|must-not-be-used|must_not_be_used/iu,
  );
  await assert.rejects(
    readFile(join(process.cwd(), platformAdminRuntimeDatabaseUrlTemporaryFile), 'utf8'),
  );
});
