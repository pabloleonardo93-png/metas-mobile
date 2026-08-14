import dotenv from 'dotenv';
import { z } from 'zod';

const splitCommaSeparated = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().trim().min(1).max(253).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine((value) => /^postgres(?:ql)?:\/\//u.test(value), 'must be a PostgreSQL URL'),
    DATABASE_SSL: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DATABASE_SSL_SERVERNAME: z.string().trim().min(1).max(253).optional(),
    CORS_ORIGINS: z.string().default(''),
    GOOGLE_ALLOWED_CLIENT_IDS: z.string().default(''),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(604_800),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') {
      return;
    }

    if (environment.HOST !== '0.0.0.0') {
      context.addIssue({
        code: 'custom',
        message: 'must be 0.0.0.0 in production',
        path: ['HOST'],
      });
    }
    if (!environment.DATABASE_SSL) {
      context.addIssue({
        code: 'custom',
        message: 'must be true in production',
        path: ['DATABASE_SSL'],
      });
    }
    if (environment.TRUST_PROXY_HOPS < 1) {
      context.addIssue({
        code: 'custom',
        message: 'must trust the Northflank ingress proxy in production',
        path: ['TRUST_PROXY_HOPS'],
      });
    }
    if (splitCommaSeparated(environment.GOOGLE_ALLOWED_CLIENT_IDS).length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'must contain at least one client ID in production',
        path: ['GOOGLE_ALLOWED_CLIENT_IDS'],
      });
    }
  });

const databaseUrlSchema = z
  .string()
  .min(1)
  .refine((value) => /^postgres(?:ql)?:\/\//u.test(value), 'must be a PostgreSQL URL');

const booleanStringSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const sslServerNameSchema = z.string().trim().min(1).max(253).optional();

export interface AppEnv {
  corsOrigins: readonly string[];
  databaseSsl: boolean;
  databaseSslServerName: string | undefined;
  databaseUrl: string;
  googleAllowedClientIds: readonly string[];
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  sessionTtlSeconds: number;
  trustProxyHops: number;
}

export interface AdminDatabaseEnv {
  adminDatabaseUrl: string;
  databaseSsl: boolean;
  databaseSslServerName: string | undefined;
}

export interface MigrationDatabaseEnv {
  databaseSsl: boolean;
  databaseSslServerName: string | undefined;
  migrationDatabaseUrl: string;
}

export interface NorthflankAdminDatabaseEnv {
  database: string;
  host: string;
  password: string;
  port: number;
  sslServerName: string | undefined;
  username: string;
}

export interface NorthflankRoleDatabaseEnv {
  database: string;
  host: string;
  password: string;
  port: number;
  sslServerName: string | undefined;
  username: string;
}

export interface NorthflankIntegrationTestEnv {
  migration: NorthflankRoleDatabaseEnv;
  runtime: NorthflankRoleDatabaseEnv;
}

export interface TestDatabaseEnv {
  databaseSsl: boolean;
  databaseSslServerName: string | undefined;
  migrationDatabaseUrl: string;
  runtimeDatabaseUrl: string;
}

const loadDotEnv = (): void => {
  dotenv.config({ quiet: true });
};

const loadNorthflankDotEnv = (): void => {
  dotenv.config({ path: '.env.northflank', quiet: true });
};

const throwInvalidEnvironment = (error: z.ZodError): never => {
  const invalidVariables = [
    ...new Set(error.issues.map((issue) => String(issue.path[0] ?? 'environment'))),
  ].join(', ');

  throw new Error(`Invalid environment configuration: ${invalidVariables}`);
};

export const loadEnv = (): AppEnv => {
  loadDotEnv();

  const parsed = rawEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    return throwInvalidEnvironment(parsed.error);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    trustProxyHops: parsed.data.TRUST_PROXY_HOPS,
    databaseUrl: parsed.data.DATABASE_URL,
    databaseSsl: parsed.data.DATABASE_SSL,
    databaseSslServerName: parsed.data.DATABASE_SSL_SERVERNAME,
    googleAllowedClientIds: splitCommaSeparated(parsed.data.GOOGLE_ALLOWED_CLIENT_IDS),
    sessionTtlSeconds: parsed.data.SESSION_TTL_SECONDS,
    corsOrigins: splitCommaSeparated(parsed.data.CORS_ORIGINS),
  };
};

type AdminDatabaseTarget = 'development' | 'test';

export const loadAdminDatabaseEnv = (
  target: AdminDatabaseTarget = 'development',
): AdminDatabaseEnv => {
  loadDotEnv();

  if (target === 'test') {
    const parsed = z
      .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        TEST_ADMIN_DATABASE_URL: databaseUrlSchema,
        TEST_DATABASE_SSL: booleanStringSchema,
        TEST_DATABASE_SSL_SERVERNAME: sslServerNameSchema,
        ADMIN_DATABASE_URL: databaseUrlSchema.optional(),
      })
      .safeParse(process.env);

    if (!parsed.success) {
      return throwInvalidEnvironment(parsed.error);
    }

    if (parsed.data.NODE_ENV === 'production') {
      throw new Error('PostgreSQL test administration is forbidden in production.');
    }

    if (!databaseNameContainsTest(parsed.data.TEST_ADMIN_DATABASE_URL)) {
      throw new Error('PostgreSQL test administration requires a database name containing "test".');
    }

    if (
      parsed.data.ADMIN_DATABASE_URL !== undefined &&
      databaseIdentity(parsed.data.TEST_ADMIN_DATABASE_URL) ===
        databaseIdentity(parsed.data.ADMIN_DATABASE_URL)
    ) {
      throw new Error('PostgreSQL test admin URL must not match the development admin URL.');
    }

    return {
      adminDatabaseUrl: parsed.data.TEST_ADMIN_DATABASE_URL,
      databaseSsl: parsed.data.TEST_DATABASE_SSL,
      databaseSslServerName: parsed.data.TEST_DATABASE_SSL_SERVERNAME,
    };
  }

  const parsed = z
    .object({
      ADMIN_DATABASE_URL: databaseUrlSchema,
      DATABASE_SSL: booleanStringSchema,
      DATABASE_SSL_SERVERNAME: sslServerNameSchema,
    })
    .safeParse(process.env);

  if (!parsed.success) {
    return throwInvalidEnvironment(parsed.error);
  }

  return {
    adminDatabaseUrl: parsed.data.ADMIN_DATABASE_URL,
    databaseSsl: parsed.data.DATABASE_SSL,
    databaseSslServerName: parsed.data.DATABASE_SSL_SERVERNAME,
  };
};

export const loadMigrationDatabaseEnv = (): MigrationDatabaseEnv => {
  loadDotEnv();
  const parsed = z
    .object({
      MIGRATION_DATABASE_URL: databaseUrlSchema,
      DATABASE_SSL: booleanStringSchema,
      DATABASE_SSL_SERVERNAME: sslServerNameSchema,
    })
    .safeParse(process.env);

  if (!parsed.success) {
    return throwInvalidEnvironment(parsed.error);
  }

  return {
    migrationDatabaseUrl: parsed.data.MIGRATION_DATABASE_URL,
    databaseSsl: parsed.data.DATABASE_SSL,
    databaseSslServerName: parsed.data.DATABASE_SSL_SERVERNAME,
  };
};

export const loadNorthflankAdminDatabaseEnv = (): NorthflankAdminDatabaseEnv => {
  loadNorthflankDotEnv();

  const parsed = z
    .object({
      NORTHFLANK_ADMIN_DB_HOST: z.string().trim().min(1).max(253),
      NORTHFLANK_ADMIN_DB_PORT: z.coerce.number().int().min(1).max(65_535),
      NORTHFLANK_ADMIN_DB_NAME: z.string().trim().min(1).max(63),
      NORTHFLANK_ADMIN_DB_USER: z.string().trim().min(1).max(63),
      NORTHFLANK_ADMIN_DB_PASSWORD: z.string().min(1),
      NORTHFLANK_DATABASE_SSL: z.literal('true'),
      NORTHFLANK_DATABASE_SSL_SERVERNAME: sslServerNameSchema,
    })
    .safeParse(process.env);

  if (!parsed.success) {
    return throwInvalidEnvironment(parsed.error);
  }

  return {
    database: parsed.data.NORTHFLANK_ADMIN_DB_NAME,
    host: parsed.data.NORTHFLANK_ADMIN_DB_HOST,
    password: parsed.data.NORTHFLANK_ADMIN_DB_PASSWORD,
    port: parsed.data.NORTHFLANK_ADMIN_DB_PORT,
    sslServerName: parsed.data.NORTHFLANK_DATABASE_SSL_SERVERNAME,
    username: parsed.data.NORTHFLANK_ADMIN_DB_USER,
  };
};

const loadNorthflankRoleDatabaseEnv = (
  role: 'migration' | 'runtime',
): NorthflankRoleDatabaseEnv => {
  loadNorthflankDotEnv();

  const roleSchema =
    role === 'migration'
      ? z.object({
          username: z.literal('metas_migration_runner'),
          password: z.string().min(1),
        })
      : z.object({
          username: z.literal('metas_app_runtime'),
          password: z.string().min(1),
        });
  const parsedCommon = z
    .object({
      NORTHFLANK_ADMIN_DB_HOST: z.string().trim().min(1).max(253),
      NORTHFLANK_ADMIN_DB_PORT: z.coerce.number().int().min(1).max(65_535),
      NORTHFLANK_ADMIN_DB_NAME: z.string().trim().min(1).max(63),
      NORTHFLANK_DATABASE_SSL: z.literal('true'),
      NORTHFLANK_DATABASE_SSL_SERVERNAME: sslServerNameSchema,
    })
    .safeParse(process.env);
  const parsedRole = roleSchema.safeParse({
    password:
      role === 'migration'
        ? process.env.NORTHFLANK_MIGRATION_DB_PASSWORD
        : process.env.NORTHFLANK_RUNTIME_DB_PASSWORD,
    username:
      role === 'migration'
        ? process.env.NORTHFLANK_MIGRATION_DB_USER
        : process.env.NORTHFLANK_RUNTIME_DB_USER,
  });

  if (!parsedCommon.success) {
    return throwInvalidEnvironment(parsedCommon.error);
  }
  if (!parsedRole.success) {
    return throwInvalidEnvironment(parsedRole.error);
  }

  return {
    database: parsedCommon.data.NORTHFLANK_ADMIN_DB_NAME,
    host: parsedCommon.data.NORTHFLANK_ADMIN_DB_HOST,
    password: parsedRole.data.password,
    port: parsedCommon.data.NORTHFLANK_ADMIN_DB_PORT,
    sslServerName: parsedCommon.data.NORTHFLANK_DATABASE_SSL_SERVERNAME,
    username: parsedRole.data.username,
  };
};

export const loadNorthflankMigrationDatabaseEnv = (): NorthflankRoleDatabaseEnv =>
  loadNorthflankRoleDatabaseEnv('migration');

export const loadNorthflankRuntimeDatabaseEnv = (): NorthflankRoleDatabaseEnv =>
  loadNorthflankRoleDatabaseEnv('runtime');

export const loadNorthflankIntegrationTestEnv = (): NorthflankIntegrationTestEnv | null => {
  loadNorthflankDotEnv();

  if (process.env.NORTHFLANK_REMOTE_TEST !== 'true') {
    return null;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Northflank integration tests are forbidden in production.');
  }
  if (!/^metas_validation_[a-f0-9]{16}$/u.test(process.env.NORTHFLANK_ADMIN_DB_NAME ?? '')) {
    throw new Error('Northflank integration tests require a generated validation database.');
  }

  return {
    migration: loadNorthflankMigrationDatabaseEnv(),
    runtime: loadNorthflankRuntimeDatabaseEnv(),
  };
};

const databaseNameContainsTest = (databaseUrl: string): boolean => {
  const pathname = new URL(databaseUrl).pathname;
  return /test/iu.test(pathname);
};

const databaseIdentity = (databaseUrl: string): string => {
  const url = new URL(databaseUrl);
  return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname.toLowerCase()}`;
};

export const loadTestDatabaseEnv = (): TestDatabaseEnv | null => {
  loadDotEnv();

  if (!process.env.TEST_DATABASE_URL && !process.env.TEST_MIGRATION_DATABASE_URL) {
    return null;
  }

  const parsed = z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      TEST_DATABASE_URL: databaseUrlSchema,
      TEST_MIGRATION_DATABASE_URL: databaseUrlSchema,
      TEST_DATABASE_SSL: booleanStringSchema,
      TEST_DATABASE_SSL_SERVERNAME: sslServerNameSchema,
      DATABASE_URL: databaseUrlSchema.optional(),
      MIGRATION_DATABASE_URL: databaseUrlSchema.optional(),
    })
    .safeParse(process.env);

  if (!parsed.success) {
    return throwInvalidEnvironment(parsed.error);
  }

  if (parsed.data.NODE_ENV === 'production') {
    throw new Error('PostgreSQL integration tests are forbidden in production.');
  }

  const { TEST_DATABASE_URL, TEST_MIGRATION_DATABASE_URL } = parsed.data;
  if (
    !databaseNameContainsTest(TEST_DATABASE_URL) ||
    !databaseNameContainsTest(TEST_MIGRATION_DATABASE_URL)
  ) {
    throw new Error('PostgreSQL integration tests require database names containing "test".');
  }

  if (
    (parsed.data.DATABASE_URL !== undefined &&
      databaseIdentity(TEST_DATABASE_URL) === databaseIdentity(parsed.data.DATABASE_URL)) ||
    (parsed.data.MIGRATION_DATABASE_URL !== undefined &&
      databaseIdentity(TEST_MIGRATION_DATABASE_URL) ===
        databaseIdentity(parsed.data.MIGRATION_DATABASE_URL))
  ) {
    throw new Error('PostgreSQL test URLs must not match development or production URLs.');
  }

  return {
    runtimeDatabaseUrl: TEST_DATABASE_URL,
    migrationDatabaseUrl: TEST_MIGRATION_DATABASE_URL,
    databaseSsl: parsed.data.TEST_DATABASE_SSL,
    databaseSslServerName: parsed.data.TEST_DATABASE_SSL_SERVERNAME,
  };
};
