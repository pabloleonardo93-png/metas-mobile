import { open, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import { isPlatformAdminDatabaseUrlValid } from '../../config/env.js';
import type { Logger } from '../../shared/logging/logger.js';
import { databaseRoles } from '../roles.js';

export const platformAdminRuntimeDatabaseUser = databaseRoles.platformAdminRuntime;
export const platformAdminRuntimeDatabaseUrlTemporaryFile = '.platform-admin-runtime-db-url.tmp';

export type PlatformAdminRuntimeDatabaseUrlFailureCode =
  | 'GENERATED_RUNTIME_DB_URL_INVALID'
  | 'INVALID_DATABASE_URL'
  | 'INVALID_COMMAND_ARGUMENT'
  | 'MISSING_DATABASE_URL'
  | 'MISSING_RUNTIME_DB_PASSWORD'
  | 'TEMPORARY_FILE_ALREADY_EXISTS'
  | 'TEMPORARY_FILE_WRITE_FAILED';

interface PlatformAdminRuntimeDatabaseUrlConfiguration {
  databaseUrl: string;
  password: string;
}

export class PlatformAdminRuntimeDatabaseUrlError extends Error {
  constructor(readonly code: PlatformAdminRuntimeDatabaseUrlFailureCode) {
    super(code);
    this.name = 'PlatformAdminRuntimeDatabaseUrlError';
  }
}

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
  const databaseUrl = environment.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    throw new PlatformAdminRuntimeDatabaseUrlError('MISSING_DATABASE_URL');
  }
  if (!isPlatformAdminDatabaseUrlValid(databaseUrl)) {
    throw new PlatformAdminRuntimeDatabaseUrlError('INVALID_DATABASE_URL');
  }
  try {
    const parsedDatabaseUrl = new URL(databaseUrl);
    if (!parsedDatabaseUrl.hostname || parsedDatabaseUrl.pathname.length <= 1) {
      throw new PlatformAdminRuntimeDatabaseUrlError('INVALID_DATABASE_URL');
    }
  } catch {
    throw new PlatformAdminRuntimeDatabaseUrlError('INVALID_DATABASE_URL');
  }

  const password = parseField(
    passwordSchema,
    environment.PLATFORM_ADMIN_RUNTIME_DB_PASSWORD,
    'MISSING_RUNTIME_DB_PASSWORD',
  );

  return { databaseUrl, password };
};

export const buildPlatformAdminRuntimeDatabaseUrl = (
  configuration: PlatformAdminRuntimeDatabaseUrlConfiguration,
): string => {
  const databaseUrl = new URL(configuration.databaseUrl);
  databaseUrl.username = platformAdminRuntimeDatabaseUser;
  databaseUrl.password = configuration.password;

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
      platformAdminDatabaseUrlPrepared: true,
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
