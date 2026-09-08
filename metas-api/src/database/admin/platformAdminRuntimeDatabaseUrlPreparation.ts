import { open, rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';

import { z } from 'zod';

import { isPlatformAdminDatabaseUrlValid } from '../../config/env.js';
import type { Logger } from '../../shared/logging/logger.js';
import { databaseRoles } from '../roles.js';

export const platformAdminRuntimeDatabaseUser = databaseRoles.platformAdminRuntime;
export const platformAdminRuntimeDatabaseUrlTemporaryFile = '.platform-admin-runtime-db-url.tmp';

export type PlatformAdminRuntimeDatabaseUrlFailureCode =
  | 'GENERATED_RUNTIME_DB_URL_INVALID'
  | 'INVALID_COMMAND_ARGUMENT'
  | 'INVALID_RUNTIME_DB_HOST'
  | 'INVALID_RUNTIME_DB_NAME'
  | 'INVALID_RUNTIME_DB_PORT'
  | 'INVALID_RUNTIME_DB_SSL'
  | 'MISSING_RUNTIME_DB_PASSWORD'
  | 'TEMPORARY_FILE_ALREADY_EXISTS'
  | 'TEMPORARY_FILE_WRITE_FAILED';

interface PlatformAdminRuntimeDatabaseUrlConfiguration {
  database: string;
  host: string;
  password: string;
  port: number;
}

export class PlatformAdminRuntimeDatabaseUrlError extends Error {
  constructor(readonly code: PlatformAdminRuntimeDatabaseUrlFailureCode) {
    super(code);
    this.name = 'PlatformAdminRuntimeDatabaseUrlError';
  }
}

const hostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(
    (value) =>
      isIP(value) !== 0 ||
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(
        value,
      ),
  );
const portSchema = z.coerce.number().int().min(1).max(65_535);
const databaseSchema = z.string().trim().min(1).max(63);
const passwordSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);

const parseField = <Result>(
  schema: z.ZodType<Result>,
  value: unknown,
  code: PlatformAdminRuntimeDatabaseUrlFailureCode,
): Result => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PlatformAdminRuntimeDatabaseUrlError(code);
  }
  return parsed.data;
};

export const parsePlatformAdminRuntimeDatabaseUrlConfiguration = (
  environment: NodeJS.ProcessEnv,
): PlatformAdminRuntimeDatabaseUrlConfiguration => {
  const host = parseField(
    hostnameSchema,
    environment.NORTHFLANK_ADMIN_DB_HOST,
    'INVALID_RUNTIME_DB_HOST',
  );
  const port = parseField(
    portSchema,
    environment.NORTHFLANK_ADMIN_DB_PORT,
    'INVALID_RUNTIME_DB_PORT',
  );
  const database = parseField(
    databaseSchema,
    environment.NORTHFLANK_ADMIN_DB_NAME,
    'INVALID_RUNTIME_DB_NAME',
  );
  const password = parseField(
    passwordSchema,
    environment.PLATFORM_ADMIN_RUNTIME_DB_PASSWORD,
    'MISSING_RUNTIME_DB_PASSWORD',
  );
  parseField(z.literal('true'), environment.NORTHFLANK_DATABASE_SSL, 'INVALID_RUNTIME_DB_SSL');

  return { database, host, password, port };
};

export const buildPlatformAdminRuntimeDatabaseUrl = (
  configuration: PlatformAdminRuntimeDatabaseUrlConfiguration,
): string => {
  const serializedHost =
    isIP(configuration.host) === 6 ? `[${configuration.host}]` : configuration.host;
  const databaseUrl = new URL(`postgresql://${serializedHost}`);
  databaseUrl.username = platformAdminRuntimeDatabaseUser;
  databaseUrl.password = configuration.password;
  databaseUrl.port = String(configuration.port);
  databaseUrl.pathname = `/${encodeURIComponent(configuration.database)}`;

  const generatedUrl = databaseUrl.toString();
  if (!isPlatformAdminDatabaseUrlValid(generatedUrl)) {
    throw new PlatformAdminRuntimeDatabaseUrlError('GENERATED_RUNTIME_DB_URL_INVALID');
  }
  return generatedUrl;
};

export const writePlatformAdminRuntimeDatabaseUrlTemporaryFile = async (
  databaseUrl: string,
  outputDirectory: string,
): Promise<string> => {
  const outputPath = resolve(outputDirectory, platformAdminRuntimeDatabaseUrlTemporaryFile);
  let file;
  try {
    file = await open(outputPath, 'wx', 0o600);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'EEXIST'
        ? 'TEMPORARY_FILE_ALREADY_EXISTS'
        : 'TEMPORARY_FILE_WRITE_FAILED';
    throw new PlatformAdminRuntimeDatabaseUrlError(code);
  }

  try {
    await file.writeFile(databaseUrl, { encoding: 'utf8' });
    await file.close();
  } catch {
    await file.close().catch(() => undefined);
    await rm(outputPath, { force: true }).catch(() => undefined);
    throw new PlatformAdminRuntimeDatabaseUrlError('TEMPORARY_FILE_WRITE_FAILED');
  }
  return outputPath;
};

export const removePlatformAdminRuntimeDatabaseUrlTemporaryFile = async (
  outputDirectory: string,
): Promise<void> => {
  await rm(resolve(outputDirectory, platformAdminRuntimeDatabaseUrlTemporaryFile), {
    force: true,
  });
};

interface PlatformAdminRuntimeDatabaseUrlPreparationDependencies {
  arguments: readonly string[];
  environment: NodeJS.ProcessEnv;
  logger: Logger;
  outputDirectory: string;
}

export const runPlatformAdminRuntimeDatabaseUrlPreparation = async (
  dependencies: PlatformAdminRuntimeDatabaseUrlPreparationDependencies,
): Promise<number> => {
  try {
    const writeTemporaryFile =
      dependencies.arguments.length === 1 && dependencies.arguments[0] === '--write-temporary-file';
    if (dependencies.arguments.length > (writeTemporaryFile ? 1 : 0)) {
      throw new PlatformAdminRuntimeDatabaseUrlError('INVALID_COMMAND_ARGUMENT');
    }

    const configuration = parsePlatformAdminRuntimeDatabaseUrlConfiguration(
      dependencies.environment,
    );
    const databaseUrl = buildPlatformAdminRuntimeDatabaseUrl(configuration);
    const outputPath = writeTemporaryFile
      ? await writePlatformAdminRuntimeDatabaseUrlTemporaryFile(
          databaseUrl,
          dependencies.outputDirectory,
        )
      : undefined;

    dependencies.logger.info('platform_admin_runtime_database_url_prepared', {
      databasePresent: true,
      hostPresent: true,
      platformAdminDatabaseUrlPrepared: true,
      portValid: true,
      roleName: platformAdminRuntimeDatabaseUser,
      schemaValid: true,
      ...(outputPath ? { outputPath } : {}),
    });
    return 0;
  } catch (error) {
    dependencies.logger.error('platform_admin_runtime_database_url_preparation_failed', {
      code:
        error instanceof PlatformAdminRuntimeDatabaseUrlError
          ? error.code
          : 'GENERATED_RUNTIME_DB_URL_INVALID',
      roleName: platformAdminRuntimeDatabaseUser,
    });
    return 1;
  }
};
