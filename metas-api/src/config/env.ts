import { Buffer } from 'node:buffer';
import { isIP } from 'node:net';

import dotenv from 'dotenv';
import { z } from 'zod';

const splitCommaSeparated = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const redisUrlSchema = z
  .url()
  .refine((value) => /^rediss?:\/\//u.test(value), 'must be a Redis URL');

const platformAdminRateLimitValueSchema = z.coerce.number().int().min(1).max(100);

const platformAdminRateLimitKeySecretSchema = z
  .string()
  .trim()
  .min(43)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u, 'must be an unpadded base64url value')
  .refine((value) => {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.byteLength >= 32 && decoded.toString('base64url') === value;
  }, 'must encode at least 32 bytes');

const webAuthnRpIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform((value) => value.toLowerCase())
  .refine(
    (value) =>
      value === 'localhost' ||
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
        value,
      ),
    'must be a valid relying party hostname',
  );

const parseWebAuthnOrigins = (value: string): string[] =>
  splitCommaSeparated(value).map((origin) => {
    const parsed = new URL(origin);
    if (
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error('WebAuthn origins must be exact origins without paths or credentials.');
    }
    return parsed.origin;
  });

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
    GOOGLE_ADMIN_ALLOWED_CLIENT_IDS: z.string().default(''),
    PLATFORM_ADMIN_AUTH_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    PLATFORM_ADMIN_DATABASE_URL: z
      .string()
      .min(1)
      .refine((value) => /^postgres(?:ql)?:\/\//u.test(value), 'must be a PostgreSQL URL')
      .optional(),
    PLATFORM_ADMIN_IDLE_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(86_400)
      .default(1_800),
    PLATFORM_ADMIN_SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(900)
      .max(86_400)
      .default(28_800),
    PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS: z.string().default(''),
    PLATFORM_ADMIN_WEBAUTHN_CHALLENGE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(600)
      .default(300),
    PLATFORM_ADMIN_WEBAUTHN_RP_ID: webAuthnRpIdSchema.optional(),
    PLATFORM_ADMIN_WEBAUTHN_RP_NAME: z.string().trim().min(1).max(100).optional(),
    PLATFORM_ADMIN_WEBAUTHN_STEP_UP_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(900)
      .default(300),
    PLATFORM_ADMIN_FIRST_ENROLLMENT_PENDING_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(900)
      .default(900),
    PLATFORM_ADMIN_FIRST_ENROLLMENT_APPROVAL_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(300)
      .default(300),
    PLATFORM_ADMIN_RATE_LIMIT_STORE: z.enum(['memory', 'redis']).optional(),
    PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL: redisUrlSchema.optional(),
    PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET: platformAdminRateLimitKeySecretSchema.optional(),
    PLATFORM_ADMIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3_600)
      .default(900),
    PLATFORM_ADMIN_RATE_LIMIT_GOOGLE_LOGIN_MAX: platformAdminRateLimitValueSchema.default(5),
    PLATFORM_ADMIN_RATE_LIMIT_REGISTRATION_OPTIONS_MAX:
      platformAdminRateLimitValueSchema.default(10),
    PLATFORM_ADMIN_RATE_LIMIT_REGISTRATION_VERIFY_MAX: platformAdminRateLimitValueSchema.default(5),
    PLATFORM_ADMIN_RATE_LIMIT_AUTHENTICATION_OPTIONS_MAX:
      platformAdminRateLimitValueSchema.default(10),
    PLATFORM_ADMIN_RATE_LIMIT_AUTHENTICATION_VERIFY_MAX:
      platformAdminRateLimitValueSchema.default(5),
    PLATFORM_ADMIN_RATE_LIMIT_FIRST_ENROLLMENT_REQUEST_MAX:
      platformAdminRateLimitValueSchema.default(3),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(604_800),
  })
  .superRefine((environment, context) => {
    if (
      environment.PLATFORM_ADMIN_IDLE_TIMEOUT_SECONDS >=
      environment.PLATFORM_ADMIN_SESSION_TTL_SECONDS
    ) {
      context.addIssue({
        code: 'custom',
        message: 'must be shorter than the platform admin session TTL',
        path: ['PLATFORM_ADMIN_IDLE_TIMEOUT_SECONDS'],
      });
    }
    if (environment.PLATFORM_ADMIN_AUTH_ENABLED) {
      if (environment.PLATFORM_ADMIN_SESSION_TTL_SECONDS >= environment.SESSION_TTL_SECONDS) {
        context.addIssue({
          code: 'custom',
          message: 'must be shorter than the mobile session TTL',
          path: ['PLATFORM_ADMIN_SESSION_TTL_SECONDS'],
        });
      }
      if (!environment.PLATFORM_ADMIN_DATABASE_URL) {
        context.addIssue({
          code: 'custom',
          message: 'is required when platform admin authentication is enabled',
          path: ['PLATFORM_ADMIN_DATABASE_URL'],
        });
      }
      if (!environment.PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET) {
        context.addIssue({
          code: 'custom',
          message: 'is required when platform admin authentication is enabled',
          path: ['PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET'],
        });
      }
      if (!environment.PLATFORM_ADMIN_RATE_LIMIT_STORE) {
        context.addIssue({
          code: 'custom',
          message: 'is required when platform admin authentication is enabled',
          path: ['PLATFORM_ADMIN_RATE_LIMIT_STORE'],
        });
      }
      if (
        environment.NODE_ENV === 'production' &&
        environment.PLATFORM_ADMIN_RATE_LIMIT_STORE !== 'redis'
      ) {
        context.addIssue({
          code: 'custom',
          message: 'must use the shared Redis store in production',
          path: ['PLATFORM_ADMIN_RATE_LIMIT_STORE'],
        });
      }
      if (
        environment.PLATFORM_ADMIN_RATE_LIMIT_STORE === 'redis' &&
        !environment.PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL
      ) {
        context.addIssue({
          code: 'custom',
          message: 'is required when the Redis rate limit store is selected',
          path: ['PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL'],
        });
      }
      if (
        environment.NODE_ENV === 'production' &&
        environment.PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL &&
        !environment.PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL.startsWith('rediss://')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'must use TLS in production',
          path: ['PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL'],
        });
      }
      const adminClientIds = splitCommaSeparated(environment.GOOGLE_ADMIN_ALLOWED_CLIENT_IDS);
      if (adminClientIds.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'must contain at least one admin client ID',
          path: ['GOOGLE_ADMIN_ALLOWED_CLIENT_IDS'],
        });
      }
      const mobileClientIds = splitCommaSeparated(environment.GOOGLE_ALLOWED_CLIENT_IDS);
      if (adminClientIds.some((clientId) => mobileClientIds.includes(clientId))) {
        context.addIssue({
          code: 'custom',
          message: 'must not reuse a mobile client ID',
          path: ['GOOGLE_ADMIN_ALLOWED_CLIENT_IDS'],
        });
      }
      if (!environment.PLATFORM_ADMIN_WEBAUTHN_RP_ID) {
        context.addIssue({
          code: 'custom',
          message: 'is required when platform admin authentication is enabled',
          path: ['PLATFORM_ADMIN_WEBAUTHN_RP_ID'],
        });
      }
      if (!environment.PLATFORM_ADMIN_WEBAUTHN_RP_NAME) {
        context.addIssue({
          code: 'custom',
          message: 'is required when platform admin authentication is enabled',
          path: ['PLATFORM_ADMIN_WEBAUTHN_RP_NAME'],
        });
      }
      let adminOrigins: string[] = [];
      try {
        adminOrigins = parseWebAuthnOrigins(environment.PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS);
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'must contain valid exact origins',
          path: ['PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS'],
        });
      }
      if (adminOrigins.length === 0) {
        context.addIssue({
          code: 'custom',
          message: 'must contain at least one origin',
          path: ['PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS'],
        });
      }
      for (const origin of adminOrigins) {
        const parsedOrigin = new URL(origin);
        if (
          parsedOrigin.hostname !== environment.PLATFORM_ADMIN_WEBAUTHN_RP_ID ||
          (environment.NODE_ENV === 'production' && parsedOrigin.protocol !== 'https:')
        ) {
          context.addIssue({
            code: 'custom',
            message: 'must use the configured RP ID and HTTPS in production',
            path: ['PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS'],
          });
        }
      }
      if (
        environment.NODE_ENV === 'production' &&
        (environment.PLATFORM_ADMIN_WEBAUTHN_RP_ID === 'localhost' ||
          isIP(environment.PLATFORM_ADMIN_WEBAUTHN_RP_ID ?? '') !== 0)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'must be a production domain name',
          path: ['PLATFORM_ADMIN_WEBAUTHN_RP_ID'],
        });
      }
    }

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
  googleAdminAllowedClientIds: readonly string[];
  host: string;
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  platformAdminAuthEnabled: boolean;
  platformAdminDatabaseUrl: string | undefined;
  platformAdminFirstEnrollmentApprovalTtlSeconds: number;
  platformAdminFirstEnrollmentPendingTtlSeconds: number;
  platformAdminIdleTimeoutSeconds: number;
  platformAdminRateLimitAuthenticationOptionsMax: number;
  platformAdminRateLimitAuthenticationVerifyMax: number;
  platformAdminRateLimitFirstEnrollmentRequestMax: number;
  platformAdminRateLimitGoogleLoginMax: number;
  platformAdminRateLimitKeySecret: string | undefined;
  platformAdminRateLimitRedisUrl: string | undefined;
  platformAdminRateLimitRegistrationOptionsMax: number;
  platformAdminRateLimitRegistrationVerifyMax: number;
  platformAdminRateLimitStore: 'memory' | 'redis';
  platformAdminRateLimitWindowSeconds: number;
  platformAdminSessionTtlSeconds: number;
  platformAdminWebAuthnAllowedOrigins: readonly string[];
  platformAdminWebAuthnChallengeTtlSeconds: number;
  platformAdminWebAuthnRpId: string | undefined;
  platformAdminWebAuthnRpName: string | undefined;
  platformAdminWebAuthnStepUpTtlSeconds: number;
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

export interface PlatformAdminOperatorDatabaseEnv {
  databaseSsl: boolean;
  databaseSslServerName: string | undefined;
  platformAdminOperatorDatabaseUrl: string;
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
  platformAdminOperator: NorthflankRoleDatabaseEnv;
  platformAdminRuntime: NorthflankRoleDatabaseEnv;
  runtime: NorthflankRoleDatabaseEnv;
}

export interface TestDatabaseEnv {
  databaseSsl: boolean;
  databaseSslServerName: string | undefined;
  migrationDatabaseUrl: string;
  platformAdminOperatorDatabaseUrl: string;
  platformAdminRuntimeDatabaseUrl: string;
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
    googleAdminAllowedClientIds: splitCommaSeparated(parsed.data.GOOGLE_ADMIN_ALLOWED_CLIENT_IDS),
    platformAdminAuthEnabled: parsed.data.PLATFORM_ADMIN_AUTH_ENABLED,
    platformAdminDatabaseUrl: parsed.data.PLATFORM_ADMIN_DATABASE_URL,
    platformAdminFirstEnrollmentApprovalTtlSeconds:
      parsed.data.PLATFORM_ADMIN_FIRST_ENROLLMENT_APPROVAL_TTL_SECONDS,
    platformAdminFirstEnrollmentPendingTtlSeconds:
      parsed.data.PLATFORM_ADMIN_FIRST_ENROLLMENT_PENDING_TTL_SECONDS,
    platformAdminIdleTimeoutSeconds: parsed.data.PLATFORM_ADMIN_IDLE_TIMEOUT_SECONDS,
    platformAdminRateLimitAuthenticationOptionsMax:
      parsed.data.PLATFORM_ADMIN_RATE_LIMIT_AUTHENTICATION_OPTIONS_MAX,
    platformAdminRateLimitAuthenticationVerifyMax:
      parsed.data.PLATFORM_ADMIN_RATE_LIMIT_AUTHENTICATION_VERIFY_MAX,
    platformAdminRateLimitFirstEnrollmentRequestMax:
      parsed.data.PLATFORM_ADMIN_RATE_LIMIT_FIRST_ENROLLMENT_REQUEST_MAX,
    platformAdminRateLimitGoogleLoginMax: parsed.data.PLATFORM_ADMIN_RATE_LIMIT_GOOGLE_LOGIN_MAX,
    platformAdminRateLimitKeySecret: parsed.data.PLATFORM_ADMIN_RATE_LIMIT_KEY_SECRET,
    platformAdminRateLimitRedisUrl: parsed.data.PLATFORM_ADMIN_RATE_LIMIT_REDIS_URL,
    platformAdminRateLimitRegistrationOptionsMax:
      parsed.data.PLATFORM_ADMIN_RATE_LIMIT_REGISTRATION_OPTIONS_MAX,
    platformAdminRateLimitRegistrationVerifyMax:
      parsed.data.PLATFORM_ADMIN_RATE_LIMIT_REGISTRATION_VERIFY_MAX,
    platformAdminRateLimitStore: parsed.data.PLATFORM_ADMIN_RATE_LIMIT_STORE ?? 'memory',
    platformAdminRateLimitWindowSeconds: parsed.data.PLATFORM_ADMIN_RATE_LIMIT_WINDOW_SECONDS,
    platformAdminSessionTtlSeconds: parsed.data.PLATFORM_ADMIN_SESSION_TTL_SECONDS,
    platformAdminWebAuthnAllowedOrigins: parseWebAuthnOrigins(
      parsed.data.PLATFORM_ADMIN_WEBAUTHN_ALLOWED_ORIGINS,
    ),
    platformAdminWebAuthnChallengeTtlSeconds:
      parsed.data.PLATFORM_ADMIN_WEBAUTHN_CHALLENGE_TTL_SECONDS,
    platformAdminWebAuthnRpId: parsed.data.PLATFORM_ADMIN_WEBAUTHN_RP_ID,
    platformAdminWebAuthnRpName: parsed.data.PLATFORM_ADMIN_WEBAUTHN_RP_NAME,
    platformAdminWebAuthnStepUpTtlSeconds: parsed.data.PLATFORM_ADMIN_WEBAUTHN_STEP_UP_TTL_SECONDS,
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

export const loadPlatformAdminOperatorDatabaseEnv = (): PlatformAdminOperatorDatabaseEnv => {
  loadDotEnv();
  const parsed = z
    .object({
      PLATFORM_ADMIN_OPERATOR_DATABASE_URL: databaseUrlSchema,
      DATABASE_SSL: booleanStringSchema,
      DATABASE_SSL_SERVERNAME: sslServerNameSchema,
    })
    .safeParse(process.env);

  if (!parsed.success) {
    return throwInvalidEnvironment(parsed.error);
  }

  return {
    platformAdminOperatorDatabaseUrl: parsed.data.PLATFORM_ADMIN_OPERATOR_DATABASE_URL,
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
  role: 'migration' | 'platform-admin-operator' | 'platform-admin-runtime' | 'runtime',
): NorthflankRoleDatabaseEnv => {
  loadNorthflankDotEnv();

  const roleSchema = z.object({
    username: z.literal(
      role === 'migration'
        ? 'metas_migration_runner'
        : role === 'platform-admin-operator'
          ? 'metas_platform_admin_operator'
          : role === 'platform-admin-runtime'
            ? 'metas_platform_admin_runtime'
            : 'metas_app_runtime',
    ),
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
        : role === 'platform-admin-operator'
          ? process.env.NORTHFLANK_PLATFORM_ADMIN_OPERATOR_DB_PASSWORD
          : role === 'platform-admin-runtime'
            ? process.env.NORTHFLANK_PLATFORM_ADMIN_RUNTIME_DB_PASSWORD
            : process.env.NORTHFLANK_RUNTIME_DB_PASSWORD,
    username:
      role === 'migration'
        ? process.env.NORTHFLANK_MIGRATION_DB_USER
        : role === 'platform-admin-operator'
          ? process.env.NORTHFLANK_PLATFORM_ADMIN_OPERATOR_DB_USER
          : role === 'platform-admin-runtime'
            ? process.env.NORTHFLANK_PLATFORM_ADMIN_RUNTIME_DB_USER
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

export const loadNorthflankPlatformAdminOperatorDatabaseEnv = (): NorthflankRoleDatabaseEnv =>
  loadNorthflankRoleDatabaseEnv('platform-admin-operator');

export const loadNorthflankRuntimeDatabaseEnv = (): NorthflankRoleDatabaseEnv =>
  loadNorthflankRoleDatabaseEnv('runtime');

export const loadNorthflankPlatformAdminRuntimeDatabaseEnv = (): NorthflankRoleDatabaseEnv =>
  loadNorthflankRoleDatabaseEnv('platform-admin-runtime');

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
    platformAdminOperator: loadNorthflankPlatformAdminOperatorDatabaseEnv(),
    platformAdminRuntime: loadNorthflankPlatformAdminRuntimeDatabaseEnv(),
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

  if (
    !process.env.TEST_DATABASE_URL &&
    !process.env.TEST_MIGRATION_DATABASE_URL &&
    !process.env.TEST_PLATFORM_ADMIN_OPERATOR_DATABASE_URL &&
    !process.env.TEST_PLATFORM_ADMIN_DATABASE_URL
  ) {
    return null;
  }

  const parsed = z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      TEST_DATABASE_URL: databaseUrlSchema,
      TEST_MIGRATION_DATABASE_URL: databaseUrlSchema,
      TEST_PLATFORM_ADMIN_OPERATOR_DATABASE_URL: databaseUrlSchema,
      TEST_PLATFORM_ADMIN_DATABASE_URL: databaseUrlSchema,
      TEST_DATABASE_SSL: booleanStringSchema,
      TEST_DATABASE_SSL_SERVERNAME: sslServerNameSchema,
      DATABASE_URL: databaseUrlSchema.optional(),
      MIGRATION_DATABASE_URL: databaseUrlSchema.optional(),
      PLATFORM_ADMIN_OPERATOR_DATABASE_URL: databaseUrlSchema.optional(),
      PLATFORM_ADMIN_DATABASE_URL: databaseUrlSchema.optional(),
    })
    .safeParse(process.env);

  if (!parsed.success) {
    return throwInvalidEnvironment(parsed.error);
  }

  if (parsed.data.NODE_ENV === 'production') {
    throw new Error('PostgreSQL integration tests are forbidden in production.');
  }

  const {
    TEST_DATABASE_URL,
    TEST_MIGRATION_DATABASE_URL,
    TEST_PLATFORM_ADMIN_DATABASE_URL,
    TEST_PLATFORM_ADMIN_OPERATOR_DATABASE_URL,
  } = parsed.data;
  if (
    !databaseNameContainsTest(TEST_DATABASE_URL) ||
    !databaseNameContainsTest(TEST_MIGRATION_DATABASE_URL) ||
    !databaseNameContainsTest(TEST_PLATFORM_ADMIN_OPERATOR_DATABASE_URL) ||
    !databaseNameContainsTest(TEST_PLATFORM_ADMIN_DATABASE_URL)
  ) {
    throw new Error('PostgreSQL integration tests require database names containing "test".');
  }

  if (
    (parsed.data.DATABASE_URL !== undefined &&
      databaseIdentity(TEST_DATABASE_URL) === databaseIdentity(parsed.data.DATABASE_URL)) ||
    (parsed.data.MIGRATION_DATABASE_URL !== undefined &&
      databaseIdentity(TEST_MIGRATION_DATABASE_URL) ===
        databaseIdentity(parsed.data.MIGRATION_DATABASE_URL)) ||
    (parsed.data.PLATFORM_ADMIN_OPERATOR_DATABASE_URL !== undefined &&
      databaseIdentity(TEST_PLATFORM_ADMIN_OPERATOR_DATABASE_URL) ===
        databaseIdentity(parsed.data.PLATFORM_ADMIN_OPERATOR_DATABASE_URL)) ||
    (parsed.data.PLATFORM_ADMIN_DATABASE_URL !== undefined &&
      databaseIdentity(TEST_PLATFORM_ADMIN_DATABASE_URL) ===
        databaseIdentity(parsed.data.PLATFORM_ADMIN_DATABASE_URL))
  ) {
    throw new Error('PostgreSQL test URLs must not match development or production URLs.');
  }

  return {
    runtimeDatabaseUrl: TEST_DATABASE_URL,
    migrationDatabaseUrl: TEST_MIGRATION_DATABASE_URL,
    platformAdminOperatorDatabaseUrl: TEST_PLATFORM_ADMIN_OPERATOR_DATABASE_URL,
    platformAdminRuntimeDatabaseUrl: TEST_PLATFORM_ADMIN_DATABASE_URL,
    databaseSsl: parsed.data.TEST_DATABASE_SSL,
    databaseSslServerName: parsed.data.TEST_DATABASE_SSL_SERVERNAME,
  };
};
