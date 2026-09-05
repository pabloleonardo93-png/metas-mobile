import { readEnvironmentDiagnosticFields } from './config/env.js';
import type { Logger } from './shared/logging/logger.js';

export const startupFailureDescriptors = {
  environmentValidation: {
    errorCode: 'ENVIRONMENT_VALIDATION_FAILED',
    phase: 'environment_validation',
  },
  httpServerInitialization: {
    errorCode: 'HTTP_SERVER_INITIALIZATION_FAILED',
    phase: 'http_server_initialization',
  },
  platformAdminDatabaseConnection: {
    errorCode: 'PLATFORM_ADMIN_DB_CONNECTION_FAILED',
    phase: 'platform_admin_database_connection',
  },
  platformAdminDatabaseCreation: {
    errorCode: 'PLATFORM_ADMIN_DB_CREATION_FAILED',
    phase: 'platform_admin_database_creation',
  },
  platformAdminDatabaseSecurityValidation: {
    errorCode: 'PLATFORM_ADMIN_DB_SECURITY_VALIDATION_FAILED',
    phase: 'platform_admin_database_security_validation',
  },
  platformAdminRedisClientCreation: {
    errorCode: 'PLATFORM_ADMIN_REDIS_CLIENT_CREATION_FAILED',
    phase: 'platform_admin_redis_client_creation',
  },
  platformAdminRedisConnection: {
    errorCode: 'PLATFORM_ADMIN_REDIS_CONNECTION_FAILED',
    phase: 'platform_admin_redis_connection',
  },
  platformAdminRedisPing: {
    errorCode: 'PLATFORM_ADMIN_REDIS_PING_FAILED',
    phase: 'platform_admin_redis_ping',
  },
  primaryDatabaseConnection: {
    errorCode: 'PRIMARY_DATABASE_CONNECTION_FAILED',
    phase: 'primary_database_connection',
  },
  primaryDatabaseCreation: {
    errorCode: 'PRIMARY_DATABASE_CREATION_FAILED',
    phase: 'primary_database_creation',
  },
  serviceInitialization: {
    errorCode: 'SERVICE_INITIALIZATION_FAILED',
    phase: 'service_initialization',
  },
} as const;

type StartupFailureDescriptor =
  (typeof startupFailureDescriptors)[keyof typeof startupFailureDescriptors];
export type StartupErrorCode =
  StartupFailureDescriptor['errorCode'] | 'UNCLASSIFIED_STARTUP_FAILURE';
export type StartupPhase = StartupFailureDescriptor['phase'] | 'unknown';

const readErrorName = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? Reflect.get(error, 'name') : undefined;

const allowedErrorTypes = new Set([
  'AggregateError',
  'Error',
  'SequelizeAccessDeniedError',
  'SequelizeConnectionAcquireTimeoutError',
  'SequelizeConnectionError',
  'SequelizeConnectionRefusedError',
  'SequelizeConnectionTimedOutError',
  'SequelizeDatabaseError',
  'SequelizeHostNotFoundError',
  'SequelizeHostNotReachableError',
  'SequelizeInvalidConnectionError',
  'TypeError',
]);

export const safeStartupErrorType = (error: unknown): string => {
  const name = readErrorName(error);
  return typeof name === 'string' && allowedErrorTypes.has(name) ? name : 'UnknownError';
};

export class StartupPhaseError extends Error {
  readonly errorCode: StartupFailureDescriptor['errorCode'];
  readonly errorType: string;
  readonly invalidFields: readonly string[] | undefined;
  readonly phase: StartupFailureDescriptor['phase'];

  constructor(descriptor: StartupFailureDescriptor, cause: unknown) {
    super('Startup phase failed', { cause });
    this.name = 'StartupPhaseError';
    this.errorCode = descriptor.errorCode;
    this.errorType = safeStartupErrorType(cause);
    this.invalidFields =
      descriptor.phase === 'environment_validation'
        ? readEnvironmentDiagnosticFields(cause)
        : undefined;
    this.phase = descriptor.phase;
  }
}

export const runStartupPhase = async <Result>(
  descriptor: StartupFailureDescriptor,
  operation: () => Promise<Result> | Result,
): Promise<Result> => {
  try {
    return await operation();
  } catch (error) {
    throw error instanceof StartupPhaseError ? error : new StartupPhaseError(descriptor, error);
  }
};

export interface StartupConnectionOperations {
  connectPlatformAdminDatabase?: () => Promise<void>;
  connectPlatformAdminRedis?: () => Promise<void>;
  connectPrimaryDatabase(): Promise<void>;
  pingPlatformAdminRedis?: () => Promise<void>;
  validatePlatformAdminDatabaseSecurity?: () => Promise<void>;
}

export const runStartupConnectionPhases = async (
  operations: StartupConnectionOperations,
): Promise<void> => {
  await runStartupPhase(startupFailureDescriptors.primaryDatabaseConnection, () =>
    operations.connectPrimaryDatabase(),
  );
  const connectPlatformAdminDatabase = operations.connectPlatformAdminDatabase;
  if (connectPlatformAdminDatabase) {
    await runStartupPhase(startupFailureDescriptors.platformAdminDatabaseConnection, () =>
      connectPlatformAdminDatabase(),
    );
  }
  const validatePlatformAdminDatabaseSecurity = operations.validatePlatformAdminDatabaseSecurity;
  if (validatePlatformAdminDatabaseSecurity) {
    await runStartupPhase(startupFailureDescriptors.platformAdminDatabaseSecurityValidation, () =>
      validatePlatformAdminDatabaseSecurity(),
    );
  }
  const connectPlatformAdminRedis = operations.connectPlatformAdminRedis;
  if (connectPlatformAdminRedis) {
    await runStartupPhase(startupFailureDescriptors.platformAdminRedisConnection, () =>
      connectPlatformAdminRedis(),
    );
  }
  const pingPlatformAdminRedis = operations.pingPlatformAdminRedis;
  if (pingPlatformAdminRedis) {
    await runStartupPhase(startupFailureDescriptors.platformAdminRedisPing, () =>
      pingPlatformAdminRedis(),
    );
  }
};

export const logServerStartupFailure = (logger: Logger, error: unknown): void => {
  const diagnostic =
    error instanceof StartupPhaseError
      ? {
          errorCode: error.errorCode,
          errorType: error.errorType,
          ...(error.invalidFields ? { invalidFields: error.invalidFields } : {}),
          phase: error.phase,
        }
      : {
          errorCode: 'UNCLASSIFIED_STARTUP_FAILURE' as const,
          errorType: safeStartupErrorType(error),
          phase: 'unknown' as const,
        };

  logger.error('startup_phase_failed', diagnostic);
  logger.error('server_start_failed', diagnostic);
};
